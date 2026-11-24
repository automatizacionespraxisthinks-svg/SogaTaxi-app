import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, MapPin, Plus } from 'lucide-react';
import type { Point, VehicleType } from '@tax/shared';
import {
  MAX_CARRERAS_ACTIVAS,
  VEHICLE_TYPES,
  VEHICLE_TYPE_LABEL,
  buscarLugar,
  crearCarreraOficinaSchema,
  telefonoColombiano,
} from '@tax/shared';
import { Banner, Button, Field, Input, Modal, SectionLabel, Select, Switch, Textarea, useToast } from '@tax/ui';
import { ApiError, api } from '../api/client';
import { usePlaces } from '../api/queries';
import { useLive } from '../live/store';
import { SelectorDePunto } from './SelectorDePunto';

/**
 * La carrera de un cliente que llamó o llegó a la oficina (24/11/2026).
 *
 * La operadora la registra aquí y desde ahí sigue el flujo de siempre: la
 * API la crea igual que las de WhatsApp —ubica la dirección con el catálogo
 * o el geocodificador, comprueba el municipio y el cupo del teléfono— y la
 * despacha por oleadas. El conductor nunca crea carreras: la recibe en su
 * teléfono y la acepta.
 *
 * El punto en el mapa es opcional. Sin él la dirección se ubica sola, como
 * las de WhatsApp; con él, el taxi va al metro que se marcó.
 */
export function NuevaCarrera({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const zonas = useLive((s) => s.zones);
  const { data: lugares = [] } = usePlaces();

  const [telefono, setTelefono] = useState('');
  const [nombre, setNombre] = useState('');
  const [direccion, setDireccion] = useState('');
  const [referencia, setReferencia] = useState('');
  const [punto, setPunto] = useState<Point | undefined>();
  const [destino, setDestino] = useState('');
  const [pasajeros, setPasajeros] = useState('1');
  const [tipo, setTipo] = useState<VehicleType>('sedan');
  const [cantidad, setCantidad] = useState('1');
  const [pagoElectronico, setPagoElectronico] = useState(false);
  const [notas, setNotas] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const reiniciar = () => {
    setTelefono('');
    setNombre('');
    setDireccion('');
    setReferencia('');
    setPunto(undefined);
    setDestino('');
    setPasajeros('1');
    setTipo('sedan');
    setCantidad('1');
    setPagoElectronico(false);
    setNotas('');
    setError(null);
  };

  const cerrar = () => {
    if (guardando) return;
    onClose();
  };

  const pedido = {
    customerPhone: telefono,
    customerName: nombre,
    pickup: {
      text: direccion.trim(),
      reference: referencia.trim() || undefined,
      point: punto,
    },
    dropoff: destino.trim() ? { text: destino.trim() } : undefined,
    vehicleType: tipo,
    passengers: pasajeros,
    cantidad,
    pagoElectronico,
    notes: notas.trim() || undefined,
  };
  const validacion = crearCarreraOficinaSchema.safeParse(pedido);
  const primerProblema = validacion.success ? null : (validacion.error.issues[0]?.message ?? 'Revisa los datos');

  // Lo mismo que hará la API con la dirección: si nombra un lugar del
  // catálogo, el taxi va a ese punto. Se avisa antes de enviar.
  const lugar = useMemo(
    () => (direccion.trim().length >= 3 ? buscarLugar(direccion, lugares) : null),
    [direccion, lugares],
  );

  const telefonoNormalizado = telefono.trim() ? telefonoColombiano(telefono) : '';

  const guardar = async () => {
    if (!validacion.success) {
      setError(primerProblema);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const creada = await api.post<{ code?: string; cantidad?: number }>('/v1/admin/rides', validacion.data);
      toast.push({
        tone: 'positive',
        title: creada.cantidad && creada.cantidad > 1 ? `${creada.cantidad} carreras creadas` : `Carrera ${creada.code ?? ''} creada`,
        description: 'Ya está buscando taxi: la verás en «Buscando taxi».',
      });
      reiniciar();
      onClose();
    } catch (causa) {
      setError(causa instanceof ApiError ? causa.message : 'No se pudo crear. Revisa la conexión y vuelve a intentarlo.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={cerrar}
      width="lg"
      title="Nueva carrera"
      subtitle="Para un cliente que llamó o llegó a la oficina. Se despacha igual que las de WhatsApp."
      footer={
        <>
          <Button variant="ghost" onClick={cerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            icon={<Plus className="size-3.5" />}
            loading={guardando}
            disabled={!validacion.success}
            onClick={() => void guardar()}
          >
            Crear y despachar
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <SectionLabel>Cliente</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Celular"
              required
              hint={
                telefonoNormalizado && telefonoNormalizado !== telefono.trim() ? `Se guarda como ${telefonoNormalizado}` : undefined
              }
            >
              <Input
                autoFocus
                type="tel"
                inputMode="tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="300 123 4567"
              />
            </Field>
            <Field label="Nombre" required>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="María Rodríguez" />
            </Field>
          </div>

          <SectionLabel>Recogida</SectionLabel>
          <Field label="Dirección o lugar" required>
            <Input
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Calle 11 # 10-45, o «la terminal»"
            />
          </Field>
          {lugar ? (
            <p className="-mt-2 flex items-center gap-1.5 text-caption text-[var(--t-positive-ink)]">
              <CheckCircle2 className="size-3.5" />
              Es «{lugar.lugar.name}» del catálogo: el taxi va a ese punto.
            </p>
          ) : null}
          <Field label="Referencia" hint="Lo que ayuda al conductor a encontrar al cliente.">
            <Input
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="Portón verde, frente a la panadería"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Pasajeros">
              <Input type="number" min={1} max={8} value={pasajeros} onChange={(e) => setPasajeros(e.target.value)} />
            </Field>
            <Field label="Vehículo">
              <Select value={tipo} onChange={(e) => setTipo(e.target.value as VehicleType)}>
                {VEHICLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {VEHICLE_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Taxis" hint={`Hasta ${MAX_CARRERAS_ACTIVAS}, al mismo punto.`}>
              <Input
                type="number"
                min={1}
                max={MAX_CARRERAS_ACTIVAS}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
            </Field>
          </div>

          <Switch
            checked={pagoElectronico}
            onChange={setPagoElectronico}
            label="Paga con pago electrónico (solo se ofrece a quien lo acepta)"
          />

          <Field label="Destino" hint="Opcional. Si no se sabe, se toma de donde finalice el conductor.">
            <Input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Hospital Regional" />
          </Field>
          <Field label="Notas para el conductor">
            <Textarea rows={2} maxLength={280} value={notas} onChange={(e) => setNotas(e.target.value)} />
          </Field>

          {error ? (
            <Banner tone="critical" icon={<AlertTriangle className="size-4" />}>
              {error}
            </Banner>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <SectionLabel>Punto exacto (opcional)</SectionLabel>
          <SelectorDePunto valor={punto} onCambiar={setPunto} zonas={zonas} className="min-h-96 flex-1" />
          {punto ? (
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-caption text-ink-secondary">
                <MapPin className="size-3.5" />
                El taxi va a este punto; la dirección queda como texto para el conductor.
              </p>
              <Button variant="ghost" size="sm" onClick={() => setPunto(undefined)}>
                Quitar punto
              </Button>
            </div>
          ) : (
            <p className="text-caption text-ink-muted">
              Sin punto, la dirección se ubica sola con el catálogo o Google, como las de WhatsApp.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
