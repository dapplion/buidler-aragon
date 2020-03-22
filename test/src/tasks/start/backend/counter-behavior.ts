import { assert } from 'chai'
import { AppStubInstance } from '~/typechain'
import { BigNumber } from 'ethers/utils'

interface ProxyInstance extends AppStubInstance {
  value: () => Promise<BigNumber>
  getVersion: () => Promise<BigNumber>
  increment: (value: number) => Promise<void>
  decrement: (value: number) => Promise<void>
}

export const assertIsCounterContract = async function(
  proxy: AppStubInstance
): Promise<void> {
  const proxyInstance: ProxyInstance = proxy as ProxyInstance
  if (!proxyInstance) throw Error('proxyInstance is not defined')
  const parse = (r: any): number => parseInt(r.toString())
  const getValue = (): Promise<number> => proxyInstance.value().then(parse)
  const x = 1

  // allows any address to increment and decrement the counter
  const initialValue = await getValue()

  await proxyInstance.increment(x)
  assert.equal(await getValue(), initialValue + x, 'Should increment')

  await proxyInstance.decrement(x)
  assert.equal(await getValue(), initialValue, 'Should decrement')

  // reports the correct hardcoded version
  const version = await proxyInstance.getVersion().then(parse)
  assert.equal(version, 0, 'Incorrect counter this.proxy version')
}
