import { useEffect } from 'react'
import { useAppStore } from '../store'

/**
 * Auto-fetches available models from the custom endpoint whenever the
 * endpoint URL or API key changes. Only active in 'custom' mode.
 */
export function useEndpointModels(): void {
  const mode = useAppStore((s) => s.connectionMode)
  const endpointUrl = useAppStore((s) => s.customEndpointConfig.endpointUrl)
  const apiKey = useAppStore((s) => s.customEndpointConfig.apiKey)
  const setModels = useAppStore((s) => s.setAvailableModels)
  const setLoading = useAppStore((s) => s.setModelsLoading)
  const setError = useAppStore((s) => s.setModelsError)

  useEffect(() => {
    if (mode !== 'custom' || !endpointUrl) {
      setModels([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    window.api?.endpoint.fetchModels(endpointUrl, apiKey || '').then((res) => {
      if (cancelled) return
      if (res.success && res.models.length > 0) {
        setModels(res.models)
        setError(null)
      } else {
        setModels([])
        setError(res.error || 'No models found at this endpoint')
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [mode, endpointUrl, apiKey, setModels, setLoading, setError])
}
