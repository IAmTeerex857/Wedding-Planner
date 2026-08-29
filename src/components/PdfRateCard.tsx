import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { FileText } from './KoboyoIcon'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

export default function PdfRateCard({ file }: { file: Blob }) {
  const [pageCount, setPageCount] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageWidth, setPageWidth] = useState(800)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(([entry]) => setPageWidth(Math.max(260, Math.min(1000, entry.contentRect.width - 32))))
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])

  return <div className="rate-card-pdf" ref={container}>
    <Document file={file} loading={<div className="rate-card-viewer-message"><FileText size={24} /><p>Rendering PDF...</p></div>} error={<div className="rate-card-viewer-message"><FileText size={24} /><p>This PDF could not be rendered.</p></div>} onLoadSuccess={({ numPages }) => { setPageCount(numPages); setPageNumber(1) }}>
      <Page pageNumber={pageNumber} width={pageWidth} renderAnnotationLayer={false} renderTextLayer={false} />
    </Document>
    {pageCount > 1 && <nav aria-label="PDF pages"><button type="button" disabled={pageNumber === 1} onClick={() => setPageNumber((current) => current - 1)}>Previous</button><span>Page {pageNumber} of {pageCount}</span><button type="button" disabled={pageNumber === pageCount} onClick={() => setPageNumber((current) => current + 1)}>Next</button></nav>}
  </div>
}
