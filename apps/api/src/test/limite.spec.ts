import { describe, expect, it } from 'vitest';
import { claveDeLimite, esAcceso } from '../common/limite';

const IP = '181.52.10.7';
const TOKEN_A = 'a'.repeat(43);
const TOKEN_B = 'b'.repeat(43);

describe('a nombre de quién se cuenta el límite de tasa', () => {
  it('dos conductores detrás de la misma IP no comparten el tope', () => {
    const uno = claveDeLimite({ url: '/v1/driver/rides/me', ip: IP, authorization: `Bearer ${TOKEN_A}` });
    const otro = claveDeLimite({ url: '/v1/driver/rides/me', ip: IP, authorization: `Bearer ${TOKEN_B}` });
    expect(uno).not.toBe(otro);
    expect(uno).not.toBe(IP);
  });

  it('el mismo conductor cae siempre en el mismo cubo, cambie o no de red', () => {
    const enWifi = claveDeLimite({ url: '/v1/driver/rides/x/accept', ip: '10.0.0.4', authorization: `Bearer ${TOKEN_A}` });
    const enDatos = claveDeLimite({ url: '/v1/driver/shift/open', ip: IP, authorization: `Bearer ${TOKEN_A}` });
    expect(enWifi).toBe(enDatos);
  });

  it('el token no queda escrito en la clave', () => {
    expect(claveDeLimite({ url: '/v1/driver/rides/me', ip: IP, authorization: `Bearer ${TOKEN_A}` })).not.toContain(TOKEN_A);
    expect(claveDeLimite({ url: '/v1/rides', ip: IP, apiKey: 'tax_secreta' })).not.toContain('tax_secreta');
  });

  it('los accesos van siempre por IP, traigan lo que traigan', () => {
    const esperado = `acceso:${IP}`;
    expect(claveDeLimite({ url: '/v1/auth/driver', ip: IP })).toBe(esperado);
    expect(claveDeLimite({ url: '/v1/auth/driver?x=1', ip: IP, authorization: `Bearer ${TOKEN_A}` })).toBe(esperado);
    expect(claveDeLimite({ url: '/v1/auth/session', ip: IP, apiKey: 'inventada' })).toBe(esperado);
  });

  it('sin token ni clave, o con un token que no lo parece, se cuenta por IP', () => {
    expect(claveDeLimite({ url: '/v1/admin/rides', ip: IP })).toBe(IP);
    expect(claveDeLimite({ url: '/v1/driver/rides/me', ip: IP, authorization: 'Bearer corto' })).toBe(IP);
    expect(claveDeLimite({ url: '/v1/driver/rides/me', ip: IP, authorization: 'Basic abcdefghijklmnopqrstuvwxyz' })).toBe(IP);
  });

  it('la clave de API manda sobre el token', () => {
    const conClave = claveDeLimite({ url: '/v1/rides', ip: IP, apiKey: 'tax_una', authorization: `Bearer ${TOKEN_A}` });
    expect(conClave.startsWith('k:')).toBe(true);
  });

  it('reconoce las dos rutas de acceso y nada más', () => {
    expect(esAcceso('/v1/auth/driver')).toBe(true);
    expect(esAcceso('/v1/auth/session?next=/')).toBe(true);
    expect(esAcceso('/v1/auth/me')).toBe(false);
    expect(esAcceso('/v1/driver/position')).toBe(false);
  });
});
