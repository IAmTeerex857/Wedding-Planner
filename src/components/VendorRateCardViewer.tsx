import { lazy, Suspense, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileText, X } from './KoboyoIcon'
import { supabase } from '../lib/supabase'
import './file-viewer.css'

const PdfRateCard = lazy(() => import('./PdfRateCard'))
const SpreadsheetPreview = lazy(() => import('./SpreadsheetPreview'))

export type VendorRateCard = {
  id: string
  vendor_id?: string
  storage_path: string
  original_name: string
  mime_type: string
  size_bytes: number
}

export function VendorRateCardViewer({ file, onClose, eyebrow = 'Private rate card' }: { file: VendorRateCard; onClose: () => void; eyebrow?: string }) {
  const [previewUrl, setPreviewUrl] = useState('')
  const fileQuery = useQuery({
    queryKey: ['private-file-blob', file.id, file.storage_path],
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
        <div><p className="eyebrow">{eyebrow}</p><h2 id="rate-card-viewer-title">{file.original_name}</h2></div>
        <div className="rate-card-viewer-actions"><button type="button" disabled={!previewUrl} onClick={download}><Download size={14} /> Download</button><button type="button" aria-label="Close rate card" onClick={onClose}><X size={17} /></button></div>
      </header>
      <div className="rate-card-viewer-body">
        {fileQuery.isPending && <div className="rate-card-viewer-message"><FileText size={24} /><p>Preparing secure preview...</p></div>}
        {fileQuery.error && <div className="rate-card-viewer-message"><FileText size={24} /><p>{fileQuery.error.message}</p></div>}
        {previewUrl && file.mime_type.startsWith('image/') && <img src={previewUrl} alt={file.original_name} />}
        {fileQuery.data && file.mime_type === 'application/pdf' && <Suspense fallback={<div className="rate-card-viewer-message"><FileText size={24} /><p>Loading PDF viewer...</p></div>}><PdfRateCard file={fileQuery.data} /></Suspense>}
        {fileQuery.data && file.mime_type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && <Suspense fallback={<div className="rate-card-viewer-message"><FileText size={24} /><p>Loading spreadsheet...</p></div>}><SpreadsheetPreview file={fileQuery.data} /></Suspense>}
        {previewUrl && !file.mime_type.startsWith('image/') && !['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(file.mime_type) && <object className="private-file-object" data={previewUrl} type={file.mime_type} aria-label={`Preview ${file.original_name}`}><div className="rate-card-viewer-message"><FileText size={24} /><p>This file cannot be rendered by your browser. Use Download to open it locally.</p></div></object>}
      </div>
    </section>
  </div>
}
