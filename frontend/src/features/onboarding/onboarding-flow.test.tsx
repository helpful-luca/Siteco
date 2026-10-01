import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import de from '../../../messages/de.json';
import { sanitizeName } from '@/shared/preferences/cookies';
import { OnboardingFlow } from './onboarding-flow';

function setup() {
  const handlers = {
    onLocaleChange: vi.fn(),
    onThemeChange: vi.fn(),
    onFinish: vi.fn(),
    onSkip: vi.fn(),
  };
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <OnboardingFlow initial={{ locale: 'de', theme: 'system', name: '' }} {...handlers} />
    </NextIntlClientProvider>,
  );
  return handlers;
}

describe('OnboardingFlow', () => {
  it('starts on the language step and announces progress', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Willkommen' })).toBeInTheDocument();
    expect(screen.getByText('Schritt 1 von 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zurück' })).not.toBeInTheDocument();
  });

  it('applies a language choice immediately', async () => {
    const { onLocaleChange } = setup();
    await userEvent.click(screen.getByRole('radio', { name: /English/ }));
    expect(onLocaleChange).toHaveBeenCalledWith('en');
  });

  it('moves forward and back between steps', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(await screen.findByRole('heading', { name: 'Erscheinungsbild' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(await screen.findByRole('heading', { name: 'Willkommen' })).toBeInTheDocument();
  });

  it('applies a theme choice immediately', async () => {
    const { onThemeChange } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Dunkel/ }));
    expect(onThemeChange).toHaveBeenCalledWith('dark');
  });

  it('finishes with Enter in the name field and returns the cleaned name', async () => {
    const { onFinish } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Weiter' }));
    const field = await screen.findByLabelText('Dein Name');
    await userEvent.type(field, '  Lena  {Enter}');
    expect(onFinish).toHaveBeenCalledWith({ locale: 'de', theme: 'system', name: 'Lena' });
  });

  it('can be skipped from any step and reports the choices so far', async () => {
    const { onSkip } = setup();
    await userEvent.click(screen.getByRole('radio', { name: /English/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    expect(onSkip).toHaveBeenCalledWith({ locale: 'en', theme: 'system' });
  });

  it('moves focus to the step heading so screen readers announce it', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    const heading = await screen.findByRole('heading', { name: 'Erscheinungsbild' });
    await vi.waitFor(() => expect(heading).toHaveFocus());
  });
});

describe('sanitizeName', () => {
  it('trims, removes control characters and caps at 40 characters', () => {
    expect(sanitizeName('  Lena\u0000\u200b ')).toBe('Lena');
    expect(sanitizeName('x'.repeat(60))).toHaveLength(40);
  });
});
