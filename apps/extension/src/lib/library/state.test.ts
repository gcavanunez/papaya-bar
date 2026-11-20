import { beforeEach, describe, expect, it } from 'vitest'
import { installFakeChrome } from '@/test/fakeChrome'
import {
	DEVICE_KEY,
	RUNTIME_KEY,
	chromeDevice,
	chromeRuntime,
	chromeState,
	memoryDevice,
	memoryRuntime,
} from './state'

const settle = async () => {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 5))
}

let fake: ReturnType<typeof installFakeChrome>
beforeEach(() => {
	fake = installFakeChrome()
})

describe('device state', () => {
	it('in memory: starts with no open session and tells listeners of changes', async () => {
		const device = memoryDevice()
		const heard: string[] = []
		device.subscribe((state) => heard.push(state.openSessionId))
		expect(device.get()).toEqual({ openSessionId: '', adoptLive: false })
		await device.set({ openSessionId: 'a' })
		await device.set({ openSessionId: 'a' })
		expect(device.get().openSessionId).toBe('a')
		expect(await device.read()).toEqual({ openSessionId: 'a', adoptLive: false })
		expect(heard).toEqual(['a'])
	})

	it('loads what is stored, ignoring anything malformed', async () => {
		fake.storage.set(DEVICE_KEY, { openSessionId: 'trip', stray: 1 })
		expect((await chromeDevice()).get()).toEqual({ openSessionId: 'trip', adoptLive: false })
		fake.storage.set(DEVICE_KEY, { openSessionId: 42, adoptLive: 'yes' })
		expect((await chromeDevice()).get()).toEqual({ openSessionId: '', adoptLive: false })
		fake.storage.set(DEVICE_KEY, 'nonsense')
		expect((await chromeDevice()).get()).toEqual({ openSessionId: '', adoptLive: false })
	})

	it('reads its own write at once and stores it', async () => {
		const device = await chromeDevice()
		const write = device.set({ openSessionId: 'trip' })
		expect(device.get().openSessionId).toBe('trip')
		await write
		expect(fake.storage.get(DEVICE_KEY)).toEqual({ openSessionId: 'trip', adoptLive: false })
	})

	it('every page and the worker follow a change made in any of them', async () => {
		const panel = await chromeDevice()
		const worker = await chromeDevice()
		const heard: string[] = []
		panel.subscribe((state) => heard.push(state.openSessionId))
		await worker.set({ openSessionId: 'work' })
		expect(panel.get().openSessionId).toBe('')
		expect((await panel.read()).openSessionId).toBe('work')
		await settle()
		expect(panel.get().openSessionId).toBe('work')
		expect(heard).toEqual(['work'])
	})

	it('writes in order, each onto what is stored, keeping fields another wrote', async () => {
		const defaults = { a: '', b: '' }
		const one = await chromeState('local', 'test:state', defaults)
		const two = await chromeState('local', 'test:state', defaults)
		await Promise.all([one.set({ a: '1' }), one.set({ a: '3' })])
		// Two has not heard of that yet; its write still keeps it
		await two.set({ b: '2' })
		expect(fake.storage.get('test:state')).toEqual({ a: '3', b: '2' })
		await settle()
		expect(one.get()).toEqual({ a: '3', b: '2' })
		expect(two.get()).toEqual({ a: '3', b: '2' })
	})
})

describe('runtime state', () => {
	it('starts unknown, in memory and in chrome.storage.session', async () => {
		expect(memoryRuntime().get()).toEqual({ link: 'unknown', linkAt: 0 })
		expect((await chromeRuntime()).get()).toEqual({ link: 'unknown', linkAt: 0 })
	})

	it('is kept in storage.session, which a page reads but cannot write', async () => {
		const worker = await chromeRuntime()
		const page = await chromeRuntime({ readOnly: true })
		await worker.set({ link: 'unlinked', linkAt: 5 })
		expect(fake.sessionStorage.get(RUNTIME_KEY)).toEqual({ link: 'unlinked', linkAt: 5 })
		expect(fake.storage.has(RUNTIME_KEY)).toBe(false)
		await settle()
		expect(page.get().link).toBe('unlinked')
		await expect(page.set({ link: 'linked' })).rejects.toThrow(/cannot change library:runtime/)
		// Device state, in storage.local, does not hear of it
		const device = await chromeDevice()
		expect(device.get()).toEqual({ openSessionId: '', adoptLive: false })
	})

	it('is gone after the extension reloads', async () => {
		await (await chromeRuntime()).set({ link: 'linked', linkAt: 1 })
		fake.reloadExtension()
		expect((await chromeRuntime()).get().link).toBe('unknown')
	})
})
