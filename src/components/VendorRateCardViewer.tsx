import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileText, X } from './KoboyoIcon'
import { supabase } from '../lib/supabase'

export type VendorRateCard = {
  id: string
  vendor_id: string
  storage_path: string
  original_name: string
  mime_type: string
  size_bytes: number
}

export function VendorRateCardViewer({ file, onClose }: { file: VendorRateCard; onClose: () => void }) {
  const signedUrlQuery = useQuery({
    queryKey: ['vendor-rate-card-url', file.id, file.storage_path],
    queryFn: async () => {
      const { data, error } = await supabase!.storage.from('wedding-files').createSignedUrl(file.storage_path, 600)
      if (error) throw error
      return data.signedUrl
    },
    staleTime: 9 * 60 * 1000,
  })

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape) }
  }, [onClose])

  function download() {
    if (!signedUrlQuery.data) return
    const anchor = document.createElement('a')
    anchor.href = signedUrlQuery.data
    anchor.download = file.original_name
    anchor.rel = 'noopener'
    anchor.click()
  }

  return <div className="rate-card-viewer-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="rate-card-viewer" role="dialog" aria-modal="true" aria-labelledby="rate-card-viewer-title">
      <header>
        <div><p className="eyebrow">Private rate card</p><h2 id="rate-card-viewer-title">{file.original_name}</h2></div>
        <div className="rate-card-viewer-actions"><button type="button" disabled={!signedUrlQuery.data} onClick={download}><Download size={14} /> Download</button><button type="button" aria-label="Close rate card" onClick={onClose}><X size={17} /></button></div>
      </header>
      <div className="rate-card-viewer-body">
        {signedUrlQuery.isPending && <div className="rate-card-viewer-message"><FileText size={24} /><p>Preparing secure preview...</p></div>}
        {signedUrlQuery.error && <div className="rate-card-viewer-message"><FileText size={24} /><p>{signedUrlQuery.error.message}</p></div>}
        {signedUrlQuery.data && file.mime_type.startsWith('image/') && <img src={signedUrlQuery.data} alt={file.original_name} />}
        {signedUrlQuery.data && file.mime_type === 'application/pdf' && <iframe src={`${signedUrlQuery.data}#view=FitH`} title={file.original_name} />}
      </div>
    </section>
  </div>
}
