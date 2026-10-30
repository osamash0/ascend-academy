/**
 * LS-001 / LS-002: the Impressum and the privacy policy name a real person and
 * a mailbox that is read, cite the laws in force (DDG, MStV), and list only
 * the services the server actually uses.
 */
import { describe, expect, it } from 'vitest';
import Impressum from '@/pages/Impressum';
import Datenschutz from '@/pages/Datenschutz';
import { renderWithProviders } from '@/test/renderWithProviders';

const HELLO = 'hello@learnstation.app';
const PRIVACY = 'privacy@learnstation.app';

describe('Impressum', () => {
  it('names the operator and a working mailbox, under § 5 DDG and § 18 MStV', () => {
    const { container } = renderWithProviders(<Impressum />, { initialEntries: ['/impressum'] });
    const text = container.textContent ?? '';
    expect(text).toContain('Abdullah Abobaker');
    expect(text).toContain('Wettergasse 6');
    expect(text).toContain('35037 Marburg');
    expect(text).toContain('§ 5 DDG');
    expect(text).toContain('§ 18');
    expect(text).not.toMatch(/TMG|RStV|\[/);
    expect(container.querySelector(`a[href="mailto:${HELLO}"]`)).not.toBeNull();
    expect(text).not.toContain('gmail.com');
  });
});

describe('Datenschutz', () => {
  it('names the controller and lists only services in use', () => {
    const { container } = renderWithProviders(<Datenschutz />, { initialEntries: ['/datenschutz'] });
    const text = container.textContent ?? '';
    expect(text).toContain('Abdullah Abobaker');
    expect(container.querySelector(`a[href="mailto:${PRIVACY}"]`)).not.toBeNull();
    expect(text).not.toContain('gmail.com');
    for (const used of ['Supabase', 'Hetzner', 'OpenAI', 'Groq', 'Gemini', 'OpenRouter']) expect(text).toContain(used);
    for (const unused of ['Sentry', 'Mistral', 'Ollama', '[']) expect(text).not.toContain(unused);
  });

  it('names Resend, which sends the account emails, among the processors and the US transfers', () => {
    const { container } = renderWithProviders(<Datenschutz />, { initialEntries: ['/datenschutz'] });
    const text = container.textContent ?? '';
    expect(text).toContain('Resend (Plus Five Five, Inc., USA)');
    expect(text).toMatch(/Microsoft, Resend, /);
  });

  it('names Cloudflare, which forwards mail to our addresses and keeps the encrypted backups', () => {
    const { container } = renderWithProviders(<Datenschutz />, { initialEntries: ['/datenschutz'] });
    const text = container.textContent ?? '';
    expect(text).toContain('Cloudflare, Inc. (USA)');
    expect(text).toMatch(/Resend, Cloudflare\)/);
  });
});
