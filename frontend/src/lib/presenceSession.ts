// This tab's presence id (crypto.randomUUID needs a secure context, which a
// plain-http LAN install isn't). Kept across Vite hot reloads, which would
// otherwise leave the old id listed until the server forgets it.
export const presenceSession: string =
  import.meta.hot?.data.session ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
if (import.meta.hot) import.meta.hot.data.session = presenceSession
