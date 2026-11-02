/// <reference types="vite/client" />

declare namespace chrome.history {
	interface VisitItem {
		isLocal: boolean
	}
}
