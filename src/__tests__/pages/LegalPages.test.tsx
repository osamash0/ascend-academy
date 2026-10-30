/**
 * LS-001 / LS-002: the Impressum and the privacy policy name a real person and
 * a mailbox that is read, cite the laws in force (DDG, MStV), and list only
 * the services the server actually uses.
 */
import { describe, expect, it } from 'vitest';
import Impressum from '@/pages/Impressum';
import Datenschutz from '@/pages/Datenschutz';
import { renderWithProviders } from '@/test/renderWithProviders';

const MAIL = 'binsalah8@gmail.com';

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
    expect(container.querySelector(`a[href="mailto:${MAIL}"]`)).not.toBeNull();
  });
});

describe('Datenschutz', () => {
  it('names the controller and lists only services in use', () => {
    const { container } = renderWithProviders(<Datenschutz />, { initialEntries: ['/datenschutz'] });
    const text = container.textContent ?? '';
    expect(text).toContain('Abdullah Abobaker');
    expect(container.querySelector(`a[href="mailto:${MAIL}"]`)).not.toBeNull();
    for (const used of ['Supabase', 'Hetzner', 'OpenAI', 'Groq', 'Gemini', 'OpenRouter']) expect(text).toContain(used);
    for (const unused of ['Sentry', 'Resend', 'Cloudflare', 'Mistral', 'Ollama', '[']) expect(text).not.toContain(unused);
  });
});
