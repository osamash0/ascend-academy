/**
 * Regression tests for useBatchUpload's submit error handling.
 *
 * Context: `submitBatch` used to be `try { ... } finally { ... }` with no
 * `catch`, and its only caller is an `async onClick` that also had no handler.
 * So a failed upload became an unhandled rejection: `finally` still cleared the
 * spinner, the queue rows stayed "queued", and the wizard looked idle and ready
 * — the user got NO indication that their upload had failed. That swallowed
 * every failure mode, not just the 429 the audit happened to catch.
 *
 * I/O boundary: apiClient (mocked).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

const uploadMock = vi.fn();
const getMock = vi.fn().mockResolvedValue({ maxBatchFiles: 30 });

vi.mock('@/lib/apiClient', () => ({
  apiClient: {
    upload: (...args: unknown[]) => uploadMock(...args),
    get: (...args: unknown[]) => getMock(...args),
    post: vi.fn(),
  },
}));

import { useBatchUpload } from '@/hooks/useBatchUpload';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderBatchUpload() {
  return renderHook(
    () => useBatchUpload({ courseId: null, parsingMode: 'ai', aiModel: 'openai' }),
    { wrapper },
  );
}

function pdf(name = 'lecture.pdf') {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });
}

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockResolvedValue({ maxBatchFiles: 30 });
});

describe('useBatchUpload — submit failures are surfaced, not swallowed', () => {
  it('reports the server detail message and marks files failed on a 429', async () => {
    // Exactly what apiClient.upload throws for a backpressure rejection.
    uploadMock.mockRejectedValue(
      new Error(
        'Upload /api/v1/upload/batch → 429: {"detail":"The processing queue is busy right now. Please retry in a few minutes."}',
      ),
    );

    const { result } = renderBatchUpload();
    act(() => { result.current.addFiles([pdf()]); });
    await waitFor(() => expect(result.current.files).toHaveLength(1));

    let returned: { batchId: string } | null = { batchId: 'unset' };
    await act(async () => { returned = await result.current.submitBatch(); });

    // Caller gets null (so it does NOT advance the wizard) rather than a throw.
    expect(returned).toBeNull();
    // The user-facing message is the server's prose, not the transport wrapper.
    expect(result.current.submitError).toBe(
      'The processing queue is busy right now. Please retry in a few minutes.',
    );
    expect(result.current.submitError).not.toContain('→');
    // The queue reflects the failure instead of sitting on "queued".
    expect(result.current.files[0].status).toBe('failed');
    // And the button is re-enabled so the user can retry.
    expect(result.current.isSubmitting).toBe(false);
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    // e.g. an HTML error page from a proxy, or a 502 with no JSON body.
    uploadMock.mockRejectedValue(new Error('Upload /api/v1/upload/batch → 502: <html>Bad Gateway</html>'));

    const { result } = renderBatchUpload();
    act(() => { result.current.addFiles([pdf()]); });
    await waitFor(() => expect(result.current.files).toHaveLength(1));

    await act(async () => { await result.current.submitBatch(); });

    expect(result.current.submitError).toBe('Upload failed. Please try again.');
    expect(result.current.files[0].status).toBe('failed');
  });

  it('clears a previous error when a later submit succeeds', async () => {
    uploadMock.mockRejectedValueOnce(new Error('Upload /api/v1/upload/batch → 500: {"detail":"boom"}'));

    const { result } = renderBatchUpload();
    act(() => { result.current.addFiles([pdf()]); });
    await waitFor(() => expect(result.current.files).toHaveLength(1));

    await act(async () => { await result.current.submitBatch(); });
    expect(result.current.submitError).toBe('boom');

    uploadMock.mockResolvedValueOnce({
      json: async () => ({
        batch_id: 'batch-1',
        files: [{ filename: 'lecture.pdf', pdf_hash: 'h1', run_id: 'r1', status: 'queued' }],
      }),
    });

    let returned: { batchId: string } | null = null;
    await act(async () => { returned = await result.current.submitBatch(); });

    expect(returned).toEqual({ batchId: 'batch-1' });
    expect(result.current.submitError).toBeNull();
  });
});
