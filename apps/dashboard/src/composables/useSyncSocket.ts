import { ref, onUnmounted } from 'vue'

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || ''
const WS_PROTOCOL = PARTYKIT_HOST.includes('localhost') ? 'ws' : 'wss'
const WS_BASE = PARTYKIT_HOST ? `${WS_PROTOCOL}://${PARTYKIT_HOST}` : ''

/**
 * Composable that opens a WebSocket to the user's sync room
 * and emits a callback whenever the server broadcasts a store update.
 */
export function useSyncSocket(token: string, userId: string, onUpdate: () => void) {
	const connected = ref(false)
	let ws: WebSocket | null = null
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null

	function connect() {
		if (!WS_BASE || !token || !userId) return

		const url = `${WS_BASE}/party/${userId}?token=${encodeURIComponent(token)}`
		ws = new WebSocket(url)

		ws.addEventListener('open', () => {
			connected.value = true
		})

		ws.addEventListener('message', (event) => {
			try {
				const data = JSON.parse(event.data as string) as { type: string }
				if (data.type === 'store:updated') {
					onUpdate()
				}
			} catch {
				// ignore
			}
		})

		ws.addEventListener('close', () => {
			connected.value = false
			// Reconnect after 5s
			reconnectTimer = setTimeout(connect, 5000)
		})

		ws.addEventListener('error', () => {
			connected.value = false
		})
	}

	function disconnect() {
		if (reconnectTimer) {
			clearTimeout(reconnectTimer)
			reconnectTimer = null
		}
		if (ws) {
			ws.close()
			ws = null
		}
		connected.value = false
	}

	connect()

	onUnmounted(disconnect)

	return { connected, disconnect }
}
