import { useEffect, useState } from 'react'
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
  const [previewUrl, setPreviewUrl] = useState('')
  const fileQuery = useQuery({
    queryKey: ['vendor-rate-card-blob', file.id, file.storage_path],
    queryFn: async () => {
      const { data, error } = await supabase!.storage.from('wedding-files').download(file.storage_path)
      if (error) throw error
      return data
    },
    staleTime: Infinity,
    gcTime: 60 * 1000,
  })

  useEffect(() => {
    if (!fileQuery.data) return
    const url = URL.createObjectURL(fileQuery.data)
    const updateUrl = window.setTimeout(() => setPreviewUrl(url), 0)
    return () => { window.clearTimeout(updateUrl); URL.revokeObjectURL(url) }
  }, [fileQuery.data])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape) }
  }, [onClose])

  function download() {
    if (!previewUrl) return
    const anchor = document.createElement('a')
    anchor.href = previewUrl
    anchor.download = file.original_name
    anchor.rel = 'noopener'
    anchor.click()
  }

  return <div className="rate-card-viewer-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="rate-card-viewer" role="dialog" aria-modal="true" aria-labelledby="rate-card-viewer-title">
      <header>
        <div><p className="eyebrow">Private rate card</p><h2 id="rate-card-viewer-title">{file.original_name}</h2></div>
        <div className="rate-card-viewer-actions"><button type="button" disabled={!previewUrl} onClick={download}><Download size={14} /> Download</button><button type="button" aria-label="Close rate card" onClick={onClose}><X size={17} /></button></div>
      </header>
      <div className="rate-card-viewer-body">
        {fileQuery.isPending && <div className="rate-card-viewer-message"><FileText size={24} /><p>Preparing secure preview...</p></div>}
        {fileQuery.error && <div className="rate-card-viewer-message"><FileText size={24} /><p>{fileQuery.error.message}</p></div>}
        {previewUrl && file.mime_type.startsWith('image/') && <img src={previewUrl} alt={file.original_name} />}
        {previewUrl && file.mime_type === 'application/pdf' && <iframe src={`${previewUrl}#view=FitH`} title={file.original_name} />}
      </div>
    </section>
  </div>
}
