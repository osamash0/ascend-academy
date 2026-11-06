import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { LayoutSwitch } from '../LayoutSwitch';

const draw = async (props: { on: boolean; available: boolean; onToggle?: () => void }, lng = 'en') => {
  await i18n.changeLanguage(lng);
  return render(
    <I18nextProvider i18n={i18n}>
      <LayoutSwitch on={props.on} available={props.available} onToggle={props.onToggle ?? (() => {})} />
    </I18nextProvider>,
  );
};

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('LayoutSwitch', () => {
  it('renders nothing when the page cannot be re-set (no disabled ghost)', async () => {
    const { container } = await draw({ on: true, available: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('is a switch named by its visible label, saying whether it is on', async () => {
    await draw({ on: false, available: true });
    const s = screen.getByRole('switch', { name: 'Layout' });
    expect(s).toHaveAttribute('aria-checked', 'false');
    expect(s).toHaveAttribute('title', 'Show this page re-set');
  });

  it('says it is on', async () => {
    await draw({ on: true, available: true });
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles on a click', async () => {
    const onToggle = vi.fn();
    await draw({ on: false, available: true, onToggle });
    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('speaks German with du', async () => {
    await draw({ on: false, available: true }, 'de');
    expect(screen.getByRole('switch', { name: 'Layout' })).toHaveAttribute('title', 'Zeig diese Seite neu gesetzt');
  });
});

describe('LayoutSwitch: focus is never dropped', () => {
  /* The switch in its row, after the view tabs, as the reader draws it. */
  const row = (available: boolean) => (
    <I18nextProvider i18n={i18n}>
      <div>
        <div role="tablist">
          <button type="button" role="tab" aria-selected="true">
            Page
          </button>
          <button type="button" role="tab" aria-selected="false">
            Text
          </button>
        </div>
        <LayoutSwitch on available={available} onToggle={() => {}} />
      </div>
    </I18nextProvider>
  );

  it('hands focus to the view tab in use when it goes while focused', () => {
    const { rerender } = render(row(true));
    screen.getByRole('switch').focus();
    rerender(row(false));
    expect(screen.queryByRole('switch')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Page' }));
  });

  it('leaves focus alone when it goes while something else holds it', () => {
    const { rerender } = render(row(true));
    const other = screen.getByRole('tab', { name: 'Text' });
    other.focus();
    rerender(row(false));
    expect(document.activeElement).toBe(other);
  });
});
