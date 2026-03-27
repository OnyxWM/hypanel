const DOWNLOADER_AUTH_EXPIRED_EVENT = "hypanel:downloader-auth-expired"

export function emitDownloaderAuthExpired(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(DOWNLOADER_AUTH_EXPIRED_EVENT))
}

export function onDownloaderAuthExpired(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {}
  }

  const handler = () => listener()
  window.addEventListener(DOWNLOADER_AUTH_EXPIRED_EVENT, handler)
  return () => {
    window.removeEventListener(DOWNLOADER_AUTH_EXPIRED_EVENT, handler)
  }
}
