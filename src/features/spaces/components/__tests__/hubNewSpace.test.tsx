import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import i18n from '@/i18n';
import SpacesHubScreen from '../../screens/SpacesHubScreen';

/*
 * LS-004. The hub replaced the Spaces screen and its New Space button went
 * with it, so anyone who already had a Space could not make another. Create
 * lives where your Spaces are listed: beside the sort, above "Your Spaces".
 * Live, a Space is a course and courses are made in the existing manager.
 */

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/v4/spaces']}>
      <Routes>
        <Route path="/v4/spaces" element={<SpacesHubScreen />} />
        <Route path="/professor/courses" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllEnvs());

describe('New Space on the hub', () => {
  it('demo: opens the New Space dialog', async () => {
    await i18n.changeLanguage('en');
    mount();
    const button = await screen.findByRole('button', { name: 'New Space' }, { timeout: 3000 });
    fireEvent.click(button);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('in German it says Neuer Space', async () => {
    await i18n.changeLanguage('de');
    mount();
    expect(await screen.findByRole('button', { name: 'Neuer Space' }, { timeout: 3000 })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });

  it('LS-050: live mode makes the Space on the stage, never in the old console', async () => {
    // Live mode needs a signed-in world, so the source is checked where it is
    // written; the live dialog itself is covered in oneApp.test.tsx.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/features/spaces/screens/SpacesHubScreen.tsx'), 'utf8');
    expect(src).toMatch(/const newSpace = \(\) => setNewOpen\(true\);/);
    expect(src).not.toMatch(/ProfessorRoutes|\?new=1/);
  });
});
