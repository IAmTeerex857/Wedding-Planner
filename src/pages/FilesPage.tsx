import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Download, File, FileImage, FileText, Trash2, Upload } from '../components/Icon'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Select } from '../components/Select'
import { VendorRateCardViewer, type VendorRateCard } from '../components/VendorRateCardViewer'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace-context'
import './files.css'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'

const categories = ['Photo', 'Inspiration', 'Receipt', 'Contract', 'Quote', 'Rate card', 'Invitation', 'Travel', 'Other']
const maxFileSize = 25 * 1024 * 1024

export function FilesPage() {
  const { workspace, userId, isPreview } = useWorkspace()
  const queryClient = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  const [viewingFile, setViewingFile] = useState<VendorRateCard | null>(null)
  const filesQuery = useQuery({
    queryKey: ['files', workspace.id],
    enabled: !isPreview,
    queryFn: async () => {
      const { data, error } = await supabase!.from('files').select('id,storage_path,original_name,mime_type,size_bytes,category,description,metadata,created_at').eq('workspace_id', workspace.id).is('deleted_at', null).order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
  const uploadMutation = useMutation({
    mutationFn: async ({ file, title, category, link }: { file: File; title: string; category: string; link: string }) => {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
      const storagePath = `${workspace.id}/${crypto.randomUUID()}/${safeName}`
      const { error: storageError } = await supabase!.storage.from('wedding-files').upload(storagePath, file, { contentType: file.type, upsert: false })
      if (storageError) throw storageError
      const { error } = await supabase!.from('files').insert({ workspace_id: workspace.id, bucket_id: 'wedding-files', storage_path: storagePath, original_name: file.name, mime_type: file.type || 'application/octet-stream', size_bytes: file.size, category, description: title || null, metadata: link ? { related_link: link } : {}, uploaded_by: userId, created_by: userId, updated_by: userId })
      if (error) {
        await supabase!.storage.from('wedding-files').remove([storagePath])
        throw error
      }
    },
    onSuccess: () => { setUploading(false); void queryClient.invalidateQueries({ queryKey: ['files', workspace.id] }) },
  })
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase!.from('files').update({ deleted_at: new Date().toISOString(), updated_by: userId }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['files', workspace.id] }),
  })
  const analyzeMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const { error } = await supabase!.functions.invoke('analyze-document', { body: { workspaceId: workspace.id, fileId } })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ido-ai', workspace.id] }),
  })

  async function download(path: string, name: string) {
    const { data, error } = await supabase!.storage.from('wedding-files').createSignedUrl(path, 60)
    if (error) return
    const anchor = document.createElement('a'); anchor.href = data.signedUrl; anchor.download = name; anchor.rel = 'noopener'; anchor.click()
  }

  const files = filesQuery.data ?? []
  const filteredFiles = categoryFilter === 'All' ? files : files.filter((file) => file.category === categoryFilter)

  return <div className="page files-page ui-page"><header className="page-header"><div><h1>Photos & files</h1><p className="page-lead">Keep receipts, contracts, quotes, rate cards, inspiration, invitation assets, and travel documents inside the shared workspace.</p></div><Button variant="primary" type="button" onClick={() => setUploading(true)}><Upload size={15} /> Upload file</Button></header>
    {uploading && <UploadForm saving={uploadMutation.isPending} onClose={() => setUploading(false)} onUpload={(payload) => uploadMutation.mutate(payload)} />}
    {(filesQuery.error || uploadMutation.error || deleteMutation.error || analyzeMutation.error) && <p className="data-error">{filesQuery.error?.message ?? uploadMutation.error?.message ?? deleteMutation.error?.message ?? analyzeMutation.error?.message}</p>}
    {analyzeMutation.isSuccess && <p className="data-success">Document analysis is queued in I Do AI.</p>}
    <div className="file-toolbar"><label><span>Category</span><Select compact aria-label="Filter by category" value={categoryFilter} onChange={setCategoryFilter} options={[{ value: 'All', label: 'All' }, ...categories.map((value) => ({ value, label: value }))]} /></label><span>{filteredFiles.length} {filteredFiles.length === 1 ? 'file' : 'files'}</span></div>
    <section className="file-grid">{filteredFiles.length ? filteredFiles.map((item) => { const link = relatedLink(item.metadata); const canAnalyze = item.mime_type.startsWith('image/') || item.mime_type === 'application/pdf'; return <article key={item.id}><div className="file-icon">{item.mime_type.startsWith('image/') ? <FileImage size={20} /> : item.mime_type === 'application/pdf' ? <FileText size={20} /> : <File size={20} />}</div><div><span>{item.category}</span><h2>{item.description || item.original_name}</h2><p>{item.original_name} / {formatBytes(item.size_bytes)}</p></div><footer><button type="button" onClick={() => setViewingFile(item)}><FileText size={14} /> View</button>{canAnalyze && <button type="button" disabled={isPreview || analyzeMutation.isPending} onClick={() => analyzeMutation.mutate(item.id)}><FileText size={14} /> Analyze with I Do AI</button>}{link && <a href={link} target="_blank" rel="noreferrer"><ArrowUpRight size={14} /> Open link</a>}<button type="button" onClick={() => void download(item.storage_path, item.original_name)}><Download size={14} /> Download</button><button type="button" onClick={() => setPendingDelete({ id: item.id, name: item.description || item.original_name })}><Trash2 size={14} /> Remove</button></footer></article> }) : <EmptyState icon={<FileText size={22} />} title={files.length ? 'No matching files' : 'No files uploaded'} description={files.length ? 'Choose another category to see more files.' : 'Files are private and downloads use short-lived signed links.'} />}</section>
    {pendingDelete && <ConfirmDialog title={`Remove ${pendingDelete.name}?`} description="This file will move to the recycle bin. Its private stored file will remain available for recovery." onCancel={() => setPendingDelete(null)} onConfirm={() => { deleteMutation.mutate(pendingDelete.id); setPendingDelete(null) }} />}
    {viewingFile && <VendorRateCardViewer file={viewingFile} eyebrow="Private file" onClose={() => setViewingFile(null)} />}
  </div>
}

function UploadForm({ saving, onClose, onUpload }: { saving: boolean; onClose: () => void; onUpload: (payload: { file: File; title: string; category: string; link: string }) => void }) {
  const [file, setFile] = useState<File | null>(null); const [title, setTitle] = useState(''); const [category, setCategory] = useState(categories[0]); const [link, setLink] = useState('')
  const [validationError, setValidationError] = useState('')
  function submit(event: FormEvent) { event.preventDefault(); if (!file) return; if (file.size > maxFileSize) { setValidationError('Choose a file smaller than 25 MB.'); return } setValidationError(''); onUpload({ file, title: title.trim(), category, link: link.trim() }) }
  return <Modal
    open
    title="Add a file"
    description="Files are private. Downloads use short-lived signed links."
    onClose={onClose}
    footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form="upload-form" disabled={saving || !file}>{saving ? 'Uploading...' : 'Upload file'}</Button>
    </>}
  >
    <form id="upload-form" className="ui-form" onSubmit={submit}><label><span>Title <small>optional</small></span><input maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Name this file" /></label><label><span>Category</span><Select aria-label="Category" value={category} onChange={setCategory} options={categories.map((value) => ({ value, label: value }))} /></label><label><span>Related link <small>optional</small></span><input type="url" pattern="https?://.*" title="Enter a complete http:// or https:// URL." maxLength={2048} placeholder="https://..." value={link} onChange={(event) => setLink(event.target.value)} /></label><label className="file-picker"><span>File</span><input type="file" required accept="image/jpeg,image/png,image/webp,application/pdf,text/csv,.xlsx" onChange={(event) => { const nextFile = event.target.files?.[0] ?? null; setFile(nextFile); setValidationError(nextFile && nextFile.size > maxFileSize ? 'Choose a file smaller than 25 MB.' : '') }} /><strong>{file?.name ?? 'Choose a file up to 25 MB'}</strong></label>{validationError && <p className="data-error file-validation-error" role="alert">{validationError}</p>}</form>
  </Modal>
}

function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1048576).toFixed(1)} MB` }
function relatedLink(metadata: unknown) { if (!metadata || typeof metadata !== 'object' || !('related_link' in metadata) || typeof metadata.related_link !== 'string') return ''; try { const url = new URL(metadata.related_link); return ['http:', 'https:'].includes(url.protocol) ? url.href : '' } catch { return '' } }
