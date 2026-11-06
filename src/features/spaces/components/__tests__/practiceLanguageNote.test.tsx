import { afterEach, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { PracticeLanguageNote } from '../PracticeLanguageNote';

afterEach(async () => { await act(() => i18n.changeLanguage('en')); });

it('identifies an untranslated question bank in the interface language', async () => {
  const { rerender } = render(<PracticeLanguageNote language="de" />);
  expect(screen.getByText(/These questions are in German/)).toBeInTheDocument();
  await act(() => i18n.changeLanguage('de'));
  expect(screen.queryByText(/These questions/)).not.toBeInTheDocument();
  rerender(<PracticeLanguageNote language="en" />);
  expect(screen.getByText(/Diese Fragen sind auf Englisch/)).toBeInTheDocument();
});

it('shows no fallback message when the question language is unknown', () => {
  const { container } = render(<PracticeLanguageNote />);
  expect(container).toBeEmptyDOMElement();
});
