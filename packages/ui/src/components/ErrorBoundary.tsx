import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button';
import { EmptyState } from './Feedback';

/**
 * Atrapa un error al pintar la pantalla (25/11/2026). Sin esto, un fallo en
 * cualquier componente dejaba la pantalla en blanco: la operadora no sabía si
 * el panel seguía vivo y el conductor no tenía ni un botón para recargar.
 *
 * Recargar es la salida: el estado vive en la API (y la cola de la PWA en el
 * teléfono). Lo único que se pierde es un formulario a medio llenar.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; className?: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Error al pintar la pantalla', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert">
        <EmptyState
          className={this.props.className ?? 'min-h-dvh'}
          tone="critical"
          icon={<span aria-hidden="true">!</span>}
          title="Algo salió mal en esta pantalla"
          description="Recarga para seguir: las carreras y los turnos están guardados en el servidor. Si vuelve a pasar, avisa a soporte."
          action={
            <Button size="touch" autoFocus onClick={() => window.location.reload()}>
              Recargar
            </Button>
          }
        />
      </div>
    );
  }
}
