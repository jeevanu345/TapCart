export type PendingStore = {
	storeId: string
	email: string
	password: string
	status: "pending" | "approved" | "denied"
	createdAt: string
}

// Use a global to survive hot reloads in dev and share across route modules
const globalKey = "__PENDING_STORES__" as const

function getStoreRef(): PendingStore[] {
	// @ts-ignore
	if (!globalThis[globalKey]) {
		// @ts-ignore
		globalThis[globalKey] = [] as PendingStore[]
	}
	// @ts-ignore
	return globalThis[globalKey] as PendingStore[]
}

export function addPendingStore(entry: Omit<PendingStore, "status" | "createdAt">) {
	const ref = getStoreRef()
	// prevent duplicates by storeId
	if (!ref.find((s) => s.storeId === entry.storeId)) {
		ref.push({ ...entry, status: "pending", createdAt: new Date().toISOString() })
	}
}

export function listPendingStores(): PendingStore[] {
	return getStoreRef().filter((s) => s.status === "pending")
}

export function listAllStores(): PendingStore[] {
	return [...getStoreRef()]
}

export function resolvePendingStore(storeId: string, action: "approve" | "deny") {
	const ref = getStoreRef()
	const idx = ref.findIndex((s) => s.storeId === storeId)
	if (idx !== -1) {
		ref[idx] = { ...ref[idx], status: action === "approve" ? "approved" : "denied" }
	}
} 