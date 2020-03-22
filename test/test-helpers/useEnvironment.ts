import { resetBuidlerContext } from '@nomiclabs/buidler/plugins-testing'
import { BuidlerRuntimeEnvironment } from '@nomiclabs/buidler/types'
import path from 'path'

declare module 'mocha' {
  interface Context {
    env: BuidlerRuntimeEnvironment
  }
}

export function useDefaultEnvironment(): void {
  useEnvironment('test-app')
}

export function useEnvironment(
  projectName: 'counter' | 'token-wrapper' | 'test-app',
  networkName = 'buidlerevm'
): void {
  const projectPath = path.join(__dirname, '../projects', projectName)
  before('loading buidler environment', function() {
    process.chdir(projectPath)
    process.env.BUIDLER_NETWORK = networkName

    this.env = require('@nomiclabs/buidler')
  })

  after('resetting buidler', function() {
    resetBuidlerContext()
    delete process.env.BUIDLER_NETWORK
  })
}
