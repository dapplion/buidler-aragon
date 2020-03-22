import { assert } from 'chai'
import { useDefaultEnvironment } from '~/test/test-helpers/useEnvironment'
import {
  getMainContractName,
  getMainContractPath,
  getAppName,
  getAppEnsName,
  readArapp
} from '~/src/utils/arappUtils'

describe('arappUtils', function() {
  useDefaultEnvironment()

  it('should read an arapp.json file', function() {
    const arapp = readArapp()
    assert(arapp != null)
  })

  it('should retrieve app name', function() {
    assert.equal(getAppName(), 'test')
  })

  it('should retrieve app ens-name', function() {
    assert.equal(getAppEnsName(), 'test.aragonpm.eth')
  })

  it('should retrieve the correct main contract path', function() {
    assert.equal(
      getMainContractPath(),
      'contracts/TestContract.sol',
      'Incorrect main contract path.'
    )
  })

  it('should retrieve the correct main contract name', function() {
    assert.equal(getMainContractName(), 'TestContract')
  })
})
