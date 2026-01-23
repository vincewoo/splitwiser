import { useEffect, useState, useRef } from 'react'
import { registerSW } from 'virtual:pwa-register'

export function UpdateNotification() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const updateSWRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    updateSWRef.current = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true)
      },
      onOfflineReady() {
        console.log('App ready to work offline')
      },
      immediate: true
    })
  }, [])

  if (!needRefresh) {
    return null
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:right-4 sm:w-96">
      <div className="rounded-lg bg-teal-600 p-4 shadow-lg dark:bg-teal-700">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg
              className="h-6 w-6 text-white animate-spin"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
              />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <p className="text-sm font-medium text-white">
              Update available
            </p>
            <p className="mt-1 text-sm text-teal-100">
              Applying the latest version...
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
