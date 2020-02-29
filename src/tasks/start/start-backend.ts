import { BuidlerRuntimeEnvironment } from '@nomiclabs/buidler/types'
import { BuidlerPluginError } from '@nomiclabs/buidler/plugins'
import chokidar from 'chokidar'
import { Writable } from 'stream'
import { AragonConfig, AragonConfigHooks } from '~/src/types'
import { KernelInstance } from '~/typechain'
import { logBack } from '~/src/ui/logger'
import { readArapp } from '~/src/utils/arappUtils'
import { TASK_COMPILE, TASK_NODE } from '~/src/tasks/task-names'
import deployBases from './backend/bases/deploy-bases'
import { createDao } from './backend/create-dao'
import { setAllPermissionsOpenly } from './backend/set-permissions'
import { startGanache } from './backend/start-ganache'
import { createApp } from './backend/create-app'
import { updateApp } from './backend/update-app'
import tcpPortUsed from 'tcp-port-used'
import onExit from '~/src/utils/onExit'
import {
  BACKEND_BUILD_STARTED,
  BACKEND_PROXY_UPDATED,
  emitEvent
} from '~/src/ui/events'
import { testnetPort } from '~/src/params'
import { generateUriArtifacts } from './frontend/generate-artifacts'

/**
 * Starts the task's backend sub-tasks. Logic is contained in ./tasks/start/utils/backend/.
 * Creates a Dao and a Repo for the app in development and watches for changes in
 * contracts. When contracts change, it compiles the contracts, deploys them and updates the
 * proxy in the Dao.
 * @returns Promise<{ daoAddress: string, appAddress: string }> Dao and app address that can
 * be used with an Aragon client to view the app.
 */
export async function startBackend(
  bre: BuidlerRuntimeEnvironment,
  appName: string,
  appId: string,
  silent: boolean
): Promise<{ daoAddress: string; appAddress: string }> {
  emitEvent(BACKEND_BUILD_STARTED)

  const config: AragonConfig = bre.config.aragon as AragonConfig
  const hooks: AragonConfigHooks = config.hooks as AragonConfigHooks

  await _compileDisablingOutput(bre, silent)

  /**
   * Until BuidlerEVM JSON RPC is ready, a ganache server will be started
   * on the appropiate conditions.
   */
  if (bre.network.name === 'buidlerevm') {
    // Run the "node" task with starts a JSON-RPC attached to the buidlerevm network
    // NOTE: The "node" task can NOT be awaited since it now waits until the server closes
    // TODO: add a configuration to the task that awaits only until listen
    bre.run(TASK_NODE, { port: testnetPort })
    await _waitForPortUsed(testnetPort)
  } else if (bre.network.name === 'localhost') {
    const networkId = await startGanache(bre)
    if (networkId !== 0) {
      logBack(`Started a ganache testnet instance with id ${networkId}.`)
    }
  } else {
    throw new BuidlerPluginError(
      'This task only supports networks buidlerevm and localhost'
    )
  }

  // Deploy bases.
  logBack('Deploying Aragon bases (ENS, DAOFactory, and APM)...')
  const { ensAddress, daoFactoryAddress, apmAddress } = await deployBases(bre)
  logBack(`ENS deployed: ${ensAddress}`)
  logBack(`DAO factory deployed: ${daoFactoryAddress}`)
  logBack(`APM deployed: ${apmAddress}`)

  // Read arapp.json.
  const arapp = readArapp()

  // Call preDao hook.
  if (hooks && hooks.preDao) {
    await hooks.preDao({}, bre)
  }

  // Create a DAO.
  logBack('Deploying DAO and app repository...')
  const dao: KernelInstance = await createDao(
    bre.web3,
    bre.artifacts,
    daoFactoryAddress
  )
  logBack(`DAO deployed: ${dao.address}`)

  // Call postDao hook.
  if (hooks && hooks.postDao) {
    await hooks.postDao({ dao }, bre)
  }

  // Create app.
  // Note: This creates the proxy, but doesn't
  // initialize it yet.
  logBack('Creating app...')
  const { proxy, repo } = await createApp(
    appName,
    appId,
    dao,
    ensAddress,
    apmAddress,
    bre
  )
  logBack(`Proxy address: ${proxy.address}`)
  logBack(`Repo address: ${repo.address}`)

  // Call preInit hook.
  if (hooks && hooks.preInit) {
    await hooks.preInit({ proxy }, bre)
  }

  // Call getInitParams hook.
  let proxyInitParams: any[] = []
  if (hooks && hooks.getInitParams) {
    const params = await hooks.getInitParams({}, bre)
    proxyInitParams = params ? params : proxyInitParams
  }
  if (proxyInitParams && proxyInitParams.length > 0) {
    logBack(`Proxy init params: ${proxyInitParams}`)
  }

  // Update app.
  const { implementationAddress, version } = await updateApp(
    appId,
    dao,
    repo,
    config.appServePort as number,
    bre
  )
  logBack(`Implementation address: ${implementationAddress}`)
  logBack(`App version: ${version}`)

  // Initialize the proxy.
  logBack('Initializing proxy...')
  await proxy.initialize(...proxyInitParams)
  logBack(`Proxy initialized: ${await proxy.hasInitialized()}`)

  // Call postInit hook.
  if (hooks && hooks.postInit) {
    await hooks.postInit({ proxy }, bre)
  }

  // TODO: What if user wants to set custom permissions?
  // Use a hook? A way to disable all open permissions?
  await setAllPermissionsOpenly(dao, proxy, arapp, bre.web3, bre.artifacts)
  logBack('All permissions set openly.')

  // Watch back-end files.
  const contractsWatcher = chokidar
    .watch('./contracts/', {
      awaitWriteFinish: { stabilityThreshold: 1000 }
    })
    .on('change', async () => {
      logBack(`Triggering backend build...`)
      const compilationSucceeded = await _compileDisablingOutput(
        bre,
        silent,
        false
      )

      // Do nothing if contract compilation fails.
      if (!compilationSucceeded) {
        logBack('Unable to update proxy, please check your contracts.')
        return
      }

      // Update artifacts.
      logBack('Updating artifacts...')
      const appBuildOutputPath = config.appBuildOutputPath as string
      await generateUriArtifacts(appBuildOutputPath, bre.artifacts)

      // Update app.
      logBack('Updating app...')
      const { implementationAddress, version } = await updateApp(
        appId,
        dao,
        repo,
        config.appServePort as number,
        bre
      )
      logBack(`Implementation address: ${implementationAddress}`)
      logBack(`App version: ${version}`)

      // Call postUpdate hook.
      if (hooks && hooks.postUpdate) {
        await hooks.postUpdate({ proxy }, bre)
      }

      emitEvent(BACKEND_PROXY_UPDATED)
    })

  onExit(() => {
    contractsWatcher.close()
  })

  return { daoAddress: dao.address, appAddress: proxy.address }
}

/**
 * Waits for a port to be used until a given timeout
 * @param port 8545
 * @param timeout in ms
 */
async function _waitForPortUsed(port: number, timeout = 10000): Promise<void> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    if (await tcpPortUsed.check(port)) return
  }
  throw new BuidlerPluginError('Testnet is not running as expected')
}

/**
 * Buidler's compile task currently calls console.logs.
 * Until they can be disabled as an option, this workaround removes them.
 */
async function _compileDisablingOutput(
  bre: BuidlerRuntimeEnvironment,
  silent: boolean,
  exitOnFailure = true
): Promise<boolean> {
  logBack('Compiling contracts...')

  const consoleCache = console

  if (silent) {
    // eslint-disable-next-line no-console
    console = new console.Console(new Writable())
  }

  let success = true
  await bre.run(TASK_COMPILE).catch(err => {
    logBack(err.message)

    success = false

    if (exitOnFailure) {
      process.exit(1)
    }
  })

  console = consoleCache

  if (success) {
    logBack('Contracts compiled.')
  }

  return success
}
