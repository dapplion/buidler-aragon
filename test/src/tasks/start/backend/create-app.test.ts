import { assert } from 'chai'
import { assertRevert } from '~/test/test-helpers/assertRevert'
import deployBases from '~/src/tasks/start/backend/bases/deploy-bases'
import { createApp } from '~/src/tasks/start/backend/create-app'
import { createDao } from '~/src/tasks/start/backend/create-dao'
import { useEnvironment } from '~/test/test-helpers/useEnvironment'
import { isNonZeroAddress } from '~/test/test-helpers/isNonZeroAddress'
import { setAllPermissionsOpenly } from '~/src/tasks/start/backend/set-permissions'
import { assertIsCounterContract } from './counter-behavior'
import {
  startGanache,
  stopGanache
} from '~/src/tasks/start/backend/start-ganache'
import { readArapp, getAppEnsName, getAppName } from '~/src/utils/arappUtils'
import { getAppId } from '~/src/utils/appName'
import { AppStubInstance, RepoInstance } from '~/typechain'

describe('create-app.ts', function() {
  // Note: These particular tests use localhost instead of buidlerevm.
  // This is required for bases to have the expected addresses,
  // And because we want to restart the chain on certain tests.
  useEnvironment('counter', 'localhost')

  let ensAddress, apmAddress, daoFactoryAddress
  let appName, appId
  let dao

  before('start ganache', async function() {
    await startGanache(this.env)
  })

  before('deploy bases', async function() {
    ;({ ensAddress, apmAddress, daoFactoryAddress } = await deployBases(
      this.env
    ))
  })

  before('deploy a dao', async function() {
    dao = await createDao(this.env.web3, this.env.artifacts, daoFactoryAddress)
  })

  before('calculate appName and appId', async function() {
    appName = getAppName()
    appId = getAppId(getAppEnsName())
  })

  after('stop ganache', async function() {
    stopGanache()
  })

  describe('when an app is created', function() {
    let appContext: {
      implementation: Truffle.ContractInstance
      proxy: AppStubInstance
      repo: RepoInstance
    }

    before('create app', async function() {
      appContext = await createApp(
        appName,
        appId,
        dao,
        ensAddress,
        apmAddress,
        this.env
      )

      await appContext.proxy.initialize()

      const arapp = readArapp()
      await setAllPermissionsOpenly(
        dao,
        appContext.proxy,
        arapp,
        this.env.web3,
        this.env.artifacts
      )
    })

    it('dao references the correct implementation for it', async function() {
      assert.equal(
        appContext.implementation.address,
        await dao.getApp(await dao.APP_BASES_NAMESPACE(), appId),
        'Incorrect implementation in proxy'
      )
    })

    it('produces a repo with a valid address', async function() {
      assert(
        isNonZeroAddress(appContext.repo.address),
        'Invalid contract address.'
      )
    })

    it('reverts when attempting to create the app again', async function() {
      await assertRevert(
        createApp(appName, appId, dao, ensAddress, apmAddress, this.env),
        'KERNEL_INVALID_APP_CHANGE'
      )
    })

    describe('when interacting with the repo', function() {
      it('returns a valid version count', async function() {
        const count = (await appContext.repo.getVersionsCount()).toNumber()
        assert.equal(count, 0, 'Invalid version count')
      })

      it('returns the expected latest version', async function() {
        await assertRevert(
          appContext.repo.getLatest(),
          'REPO_INEXISTENT_VERSION'
        )
      })
    })

    describe('when interacting with the proxy', function() {
      it('proxy references the dao that created it', async function() {
        assert.equal(
          dao.address,
          await appContext.proxy.kernel(),
          'Incorrect kernel in proxy'
        )
      })

      it('assert counter contract functionality', async function() {
        await assertIsCounterContract(appContext.proxy)
      })
    })
  })
})
