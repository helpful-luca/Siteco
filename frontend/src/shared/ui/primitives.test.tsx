import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Badge, Button, ChoiceCards, SegmentedControl, ThemeThumbnail } from '@/shared/ui';

describe('Button', () => {
  it('renders a native button with the variant as data attribute', () => {
    render(<Button variant="primary">Frage stellen</Button>);
    const button = screen.getByRole('button', { name: 'Frage stellen' });
    expect(button).toHaveAttribute('data-variant', 'primary');
    expect(button).toHaveAttribute('type', 'button');
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'light', label: 'Hell' },
    { value: 'dark', label: 'Dunkel' },
    { value: 'system', label: 'Automatisch' },
  ];

  it('draws one shared indicator inside the chosen segment', () => {
    const { container, rerender } = render(
      <SegmentedControl label="Erscheinungsbild" options={options} value="light" onValueChange={() => {}} />,
    );
    const indicators = () => container.querySelectorAll('[data-segment-indicator]');
    expect(indicators()).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Hell' })).toContainElement(indicators()[0] as HTMLElement);
    rerender(<SegmentedControl label="Erscheinungsbild" options={options} value="system" onValueChange={() => {}} />);
    expect(indicators()).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Automatisch' })).toContainElement(indicators()[0] as HTMLElement);
  });
});

describe('Badge', () => {
  it('shows its text so status is not conveyed by color alone', () => {
    render(<Badge tone="failed">Fehler</Badge>);
    expect(screen.getByText('Fehler')).toHaveAttribute('data-tone', 'failed');
  });
});

describe('ChoiceCards', () => {
  it('names picture choices by their title and marks the chosen one', () => {
    render(
      <ChoiceCards
        label="Erscheinungsbild"
        value="light"
        onValueChange={vi.fn()}
        choices={(['light', 'dark'] as const).map((theme) => ({
          value: theme,
          title: theme === 'light' ? 'Hell' : 'Dunkel',
          visual: <ThemeThumbnail theme={theme} />,
        }))}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Hell' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Dunkel' })).toHaveAttribute('aria-checked', 'false');
  });
});
