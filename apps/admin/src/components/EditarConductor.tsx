import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Driver } from '@tax/shared';
import { telefonoColombiano } from '@tax/shared';
import { Banner, Button, Field, Input, Modal, useToast } from '@tax/ui';
import { ApiError, api } from '../api/client';
import { actions } from '../live/store';
import { useCedula } from './ConductorAdmin';
import { CamposExtraDeLaFicha, camposExtraValidos, soloCamposEnUso, useCamposExtra } from './CamposExtra';

/**
 * Editar los datos de un conductor (26/11/2026).
 *
 * Hasta aquí el panel dejaba activar, suspender o cambiar el PIN, pero no
 * corregir el nombre, el celular, la cédula ni la licencia: eso solo entraba
 * con la carga masiva. Con la flota cargada desde Autocab —cientos sin
 * cédula o con la licencia vencida— la oficina tiene que poder completarlos.
 *
 * La cédula se guarda cifrada. Desde el 28/11/2026 se muestra aquí, a quien
 * puede gestionar conductores, para poder revisarla y corregirla.
 */
export function EditarConductor({ driver, onCerrar }: { driver: Driver; onCerrar: () => void }) {
  const toast = useToast();
  const campos = useCamposExtra().data ?? [];
  const [nombre, setNombre] = useState(driver.name);
  const telefonoInicial = driver.phone.replace(/^\+57/, '');
  const [telefono, setTelefono] = useState(telefonoInicial);
  const qc = useQueryClient();
  const guardada = useCedula(driver.id);
  const cedulaGuardada = guardada.data?.cedula ?? '';
  const [cedula, setCedula] = useState('');
  const [cedulaTocada, setCedulaTocada] = useState(false);
  // Llega un instante después de abrir: se pone si aún no se ha escrito nada.
  useEffect(() => {
    if (!cedulaTocada && cedulaGuardada) setCedula(cedulaGuardada);
  }, [cedulaGuardada, cedulaTocada]);
  const cambioLaCedula = cedula !== '' && cedula !== cedulaGuardada;
  const [licencia, setLicencia] = useState(driver.licenciaVence ?? '');
  const [restriccion, setRestriccion] = useState(driver.licenciaRestriccion ?? '');
  const [extra, setExtra] = useState<Record<string, string>>(driver.extra ?? {});
  const [error, setError] = useState<string | null>(null);

  // El celular solo se revisa y se manda si se tocó: uno viejo con un formato
  // raro no puede impedir corregir la licencia o la cédula.
  const cambioElCelular = telefono.trim() !== telefonoInicial;
  const celular = cambioElCelular && telefono.trim() ? telefonoColombiano(telefono) : '';
  const celularValido = !cambioElCelular || (celular !== '' && /^\+\d{8,15}$/.test(celular));
  const cedulaValida = cedula === '' || /^\d{6,10}$/.test(cedula);
  const listo = nombre.trim().length >= 3 && celularValido && cedulaValida && camposExtraValidos(campos, 'conductor', extra);

  const guardar = useMutation({
    mutationFn: () =>
      api.patch(`/v1/admin/drivers/${driver.id}`, {
        name: nombre.trim(),
        ...(celular ? { phone: celular } : {}),
        ...(cambioLaCedula ? { cedula } : {}),
        licenseExpiresOn: licencia || null,
        licenseRestriction: restriccion.trim() || null,
        extra: soloCamposEnUso(campos, 'conductor', extra),
      }),
    onSuccess: async () => {
      await actions.refreshDrivers();
      await qc.invalidateQueries({ queryKey: ['cedula', driver.id] });
      toast.push({ tone: 'positive', title: 'Datos actualizados', description: `${nombre.trim()} · código ${driver.code}` });
      onCerrar();
    },
    onError: (e) => setError((e instanceof ApiError && e.message) || 'No se pudo guardar.'),
  });

  return (
    <Modal
      open
      onClose={onCerrar}
      title={`Editar a ${driver.name}`}
      subtitle={`Código ${driver.code}. El código y el PIN no se cambian aquí.`}
      footer={
        <>
          <Button size="lg" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button variant="primary" size="lg" disabled={!listo} loading={guardar.isPending} onClick={() => guardar.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre completo" htmlFor="ed-nombre" required>
          <Input id="ed-nombre" value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Celular"
            htmlFor="ed-celular"
            hint={!celularValido ? 'No parece un celular' : celular && celular !== telefono.trim() ? `Se guarda como ${celular}` : undefined}
          >
            <Input
              id="ed-celular"
              type="tel"
              inputMode="tel"
              placeholder="300 123 4567"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
            />
          </Field>
          <Field
            label="Cédula"
            htmlFor="ed-cedula"
            hint={
              !cedulaValida
                ? 'Entre 6 y 10 dígitos, sin puntos'
                : cedulaGuardada
                  ? cedula === '' ? 'No se puede dejar vacía: se conserva la que tenía.' : undefined
                  : driver.tieneCedula
                    ? 'Está registrada pero no se puede mostrar. Escríbala de nuevo.'
                    : 'Falta: escríbala para registrarla.'
            }
          >
            <Input
              id="ed-cedula"
              inputMode="numeric"
              maxLength={10}
              placeholder={driver.tieneCedula ? 'Registrada' : 'Sin registrar'}
              value={cedula}
              onChange={(e) => {
                setCedulaTocada(true);
                setCedula(e.target.value.replace(/\D/g, ''));
              }}
            />
          </Field>
          <Field label="Vence la licencia" htmlFor="ed-licencia" hint="Con la fecha, el panel avisa antes de que venza.">
            <Input id="ed-licencia" type="date" value={licencia} onChange={(e) => setLicencia(e.target.value)} />
          </Field>
          <Field label="Restricción de la licencia" htmlFor="ed-restriccion" hint="Por ejemplo: usa lentes.">
            <Input id="ed-restriccion" maxLength={120} value={restriccion} onChange={(e) => setRestriccion(e.target.value)} />
          </Field>
        </div>
        <CamposExtraDeLaFicha entidad="conductor" valores={extra} onCambiar={setExtra} />
        {error ? <Banner tone="critical">{error}</Banner> : null}
      </div>
    </Modal>
  );
}
