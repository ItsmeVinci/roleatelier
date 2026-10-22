import { useEffect, useState } from 'react';
import type { Doc } from '@shared/types';
import { api, apiText, download } from '../api';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { ConfirmButton, Modal, Tabs } from './ui';

type Kind = 'resume' | 'cover';

export function DocViewer({
  docs,
  subtitle,
  onClose,
  onChanged,
}: {
  docs: { resume?: Doc; cover?: Doc };
  subtitle?: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [versions, setVersions] = useState(docs);
  const initialTab: Kind = docs.resume ? 'resume' : 'cover';
  const [tab, setTab] = useState<Kind>(initialTab);
  const [draft, setDraft] = useState<string>(docs[initialTab]?.content ?? '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const doc = versions[tab];

  useEffect(() => {
    setDraft(versions[tab]?.content ?? '');
    setDirty(false);
  }, [tab, versions]);

  const tabs = [
    ...(versions.resume ? [{ id: 'resume' as Kind, label: 'Resume' }] : []),
    ...(versions.cover ? [{ id: 'cover' as Kind, label: 'Cover letter' }] : []),
  ];

  async function save() {
    if (!doc) return;
    setSaving(true);
    try {
      const res = await api.put<{ doc: Doc }>(`/docs/${doc.id}`, { content: draft });
      const next = res.doc;
      setVersions((v) => ({ ...v, [tab]: next }));
      setDirty(false);
      toast('Document saved');
      onChanged?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save', 'err');
    } finally {
      setSaving(false);
    }
  }

  async function copyPrompt() {
    if (!doc) return;
    try {
      const prompt = await apiText(`/docs/${doc.id}/prompt`);
      await navigator.clipboard.writeText(prompt);
      toast('AI prompt copied — paste it into any assistant to refine the draft');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not copy the prompt', 'err');
    }
  }

  async function remove() {
    if (!doc) return;
    try {
      await api.del(`/docs/${doc.id}`);
      const next = { ...versions };
      delete next[tab];
      setVersions(next);
      const remaining: Kind | null = next.resume ? 'resume' : next.cover ? 'cover' : null;
      if (!remaining) {
        onClose();
        toast('Document deleted');
      } else {
        setTab(remaining);
        toast('Document deleted');
      }
      onChanged?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete', 'err');
    }
  }

  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return (
    <Modal
      title={
        <span className="row" style={{ gap: 9 }}>
          <Icon name="file" size={16} />
          {doc?.title ?? 'Tailored documents'}
        </span>
      }
      onClose={onClose}
      width={900}
      footer={
        <>
          {doc && (
            <>
              <ConfirmButton onConfirm={remove} label="Delete" confirmLabel="Delete this document?" />
              <button className="btn" onClick={copyPrompt}>
                <Icon name="sparkles" size={14} /> Copy AI prompt
              </button>
              <button className="btn" onClick={() => download(`/docs/${doc.id}/download?format=md`)}>
                <Icon name="download" size={14} /> .md
              </button>
              <button className="btn" onClick={() => window.open(`/api/docs/${doc.id}/render`, '_blank', 'noopener')}>
                <Icon name="printer" size={14} /> Print / PDF
              </button>
            </>
          )}
          <div className="spacer" />
          <button className="btn" onClick={() => navigator.clipboard.writeText(draft).then(() => toast('Markdown copied'))}>
            <Icon name="copy" size={14} /> Copy
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!doc || !dirty || saving}>
            {saving ? <span className="spinner" /> : <Icon name="check" size={14} />}
            Save draft
          </button>
        </>
      }
    >
      {subtitle && <div className="hint" style={{ marginBottom: 12 }}>{subtitle}</div>}
      {tabs.length > 1 && <Tabs value={tab} options={tabs} onChange={setTab} />}
      {!doc ? (
        <div className="empty" style={{ marginTop: 16 }}>
          <h3>No documents yet</h3>
          <p>Tailor a resume and cover letter from a job in the feed — they will appear here.</p>
        </div>
      ) : (
        <>
          <div className="row" style={{ margin: '12px 0 8px' }}>
            <span className="hint">
              Markdown · {words} words · {draft.length} characters
            </span>
            <div className="spacer" />
            {dirty ? (
              <>
                <span className="badge badge-amber">Unsaved changes</span>
                <button className="btn btn-ghost btn-sm" onClick={() => { setDraft(doc.content); setDirty(false); }}>
                  Revert
                </button>
              </>
            ) : (
              <span className="badge badge-green">
                <Icon name="check" size={10} /> Saved
              </span>
            )}
          </div>
          <textarea
            className="textarea doc-editor"
            value={draft}
            spellCheck
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(e.target.value !== doc.content);
            }}
          />
          <div className="hint" style={{ marginTop: 8 }}>
            Edit freely, then <strong>Print / PDF</strong> opens a clean A4 layout — choose “Save as PDF” in the print dialog.
          </div>
        </>
      )}
    </Modal>
  );
}

export async function loadJobDocs(jobId: number): Promise<{ resume?: Doc; cover?: Doc }> {
  const metas = await api.get<{ docs: { id: number; kind: Kind }[] }>(`/docs?jobId=${jobId}`);
  const out: { resume?: Doc; cover?: Doc } = {};
  for (const meta of metas.docs) {
    if (out[meta.kind]) continue; // newest first from the API
    const res = await api.get<{ doc: Doc }>(`/docs/${meta.id}`);
    out[meta.kind] = res.doc;
  }
  return out;
}
