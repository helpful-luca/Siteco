import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Badge, Button, ChoiceCards, Dialog, SegmentedControl, Switch, ThemeThumbnail } from '@/shared/ui';

describe('Button', () => {
  it('renders a native button with the variant as data attribute', () => {
    render(<Button variant="primary">Frage stellen</Button>);
    const button = screen.getByRole('button', { name: 'Frage stellen' });
    expect(button).toHaveAttribute('data-variant', 'primary');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Senden
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('names icon-only buttons through aria-label', () => {
    render(<Button icon aria-label="Neuer Chat" />);
    expect(screen.getByRole('button', { name: 'Neuer Chat' })).toBeInTheDocument();
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'light', label: 'Hell' },
    { value: 'dark', label: 'Dunkel' },
    { value: 'system', label: 'Automatisch' },
  ];

  it('moves the selection with arrow keys', async () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        label="Erscheinungsbild"
        options={options}
        value="light"
        onValueChange={onValueChange}
      />,
    );
    const light = screen.getByRole('radio', { name: 'Hell' });
    light.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenCalledWith('dark');
  });

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

describe('Switch', () => {
  it('toggles and reports the new state', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Vergleichen" checked={false} onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Vergleichen' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe('Badge', () => {
  it('shows its text so status is not conveyed by color alone', () => {
    render(<Badge tone="failed">Fehler</Badge>);
    expect(screen.getByText('Fehler')).toHaveAttribute('data-tone', 'failed');
  });
});

describe('Dialog', () => {
  it('opens, labels itself and closes on Escape', async () => {
    render(
      <Dialog trigger={<Button>Einstellungen</Button>} title="Einstellungen" description="Alles an einem Ort.">
        <p>Inhalt</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Einstellungen' }));
    expect(await screen.findByRole('dialog', { name: 'Einstellungen' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('ChoiceCards', () => {
  it('names picture choices by their title and moves the choice with arrow keys', async () => {
    const onValueChange = vi.fn();
    render(
      <ChoiceCards
        label="Erscheinungsbild"
        value="light"
        onValueChange={onValueChange}
        choices={(['light', 'dark'] as const).map((theme) => ({
          value: theme,
          title: theme === 'light' ? 'Hell' : 'Dunkel',
          visual: <ThemeThumbnail theme={theme} />,
        }))}
      />,
    );
    const light = screen.getByRole('radio', { name: 'Hell' });
    expect(light).toHaveAttribute('aria-checked', 'true');
    light.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenCalledWith('dark');
  });
});
