import json
import os
import unittest
from unittest.mock import patch

from cliente_puente_alertas import (
    ErrorPuenteAlerta,
    notificar_si_emergencia,
)


class Respuesta:
    def __init__(self, datos, status=200):
        self.status = status
        self.datos = json.dumps(datos).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self.datos


class PruebasClientePuente(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "LINDSY_ALERT_BRIDGE_URL": "https://puente-ejemplo.invalid",
            "LINDSY_ALERT_BRIDGE_TOKEN": "token-de-prueba",
        })
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_no_emergencia_no_hace_llamada(self):
        llamadas = []
        r = notificar_si_emergencia(
            {"estado": "no_emergencia"}, "evento_prueba_000001",
            habilitado=True, urlopen=lambda *a, **k: llamadas.append(1),
        )
        self.assertEqual(r["estado"], "omitida")
        self.assertEqual(llamadas, [])

    def test_modo_simulacion_local_no_hace_llamada(self):
        llamadas = []
        r = notificar_si_emergencia(
            {"estado": "emergencia"}, "evento_prueba_000001",
            habilitado=False, urlopen=lambda *a, **k: llamadas.append(1),
        )
        self.assertEqual(r["estado"], "simulacion_local")
        self.assertEqual(llamadas, [])

    def test_confirmacion_simulada_del_puente(self):
        capturado = {}
        def falso(req, timeout):
            capturado["url"] = req.full_url
            capturado["body"] = json.loads(req.data)
            capturado["auth"] = req.get_header("Authorization")
            return Respuesta({"ok": True, "modo": "simulacion"})
        r = notificar_si_emergencia(
            {"estado": "emergencia"}, "evento_prueba_000001",
            categoria="emergencia_medica", detalle="Resumen breve",
            habilitado=True, urlopen=falso, pausas=(),
        )
        self.assertEqual(r["estado"], "simulada")
        self.assertTrue(capturado["url"].endswith("/api/alertas/emergencia"))
        self.assertEqual(capturado["body"]["categoria"], "emergencia_medica")
        self.assertEqual(capturado["auth"], "Bearer token-de-prueba")
        self.assertNotIn("transcripcion", capturado["body"])

    def test_no_envia_transcripcion_completa(self):
        capturado = {}
        def falso(req, timeout):
            capturado.update(json.loads(req.data))
            return Respuesta({"ok": True, "modo": "simulacion"})
        notificar_si_emergencia(
            {"estado": "emergencia", "transcripcion": "dato privado"},
            "evento_prueba_000001", detalle="Resumen",
            habilitado=True, urlopen=falso, pausas=(),
        )
        self.assertNotIn("transcripcion", capturado)
        self.assertNotIn("dato privado", json.dumps(capturado))

    def test_valida_categoria(self):
        with self.assertRaises(ValueError):
            notificar_si_emergencia(
                {"estado": "emergencia"}, "evento_prueba_000001",
                categoria="cotidiano", habilitado=False,
            )

    def test_valida_event_id(self):
        with self.assertRaises(ValueError):
            notificar_si_emergencia(
                {"estado": "emergencia"}, "corto", habilitado=False,
            )

    def test_requiere_url_https_y_token(self):
        with patch.dict(os.environ, {
            "LINDSY_ALERT_BRIDGE_URL": "http://inseguro",
            "LINDSY_ALERT_BRIDGE_TOKEN": "",
        }):
            with self.assertRaises(ErrorPuenteAlerta):
                notificar_si_emergencia(
                    {"estado": "emergencia"}, "evento_prueba_000001",
                    habilitado=True, pausas=(),
                )

    def test_rechazo_http_no_se_oculta(self):
        import urllib.error
        def falso(*args, **kwargs):
            raise urllib.error.HTTPError("https://ejemplo.invalid", 401, "no", {}, None)
        with self.assertRaises(ErrorPuenteAlerta):
            notificar_si_emergencia(
                {"estado": "emergencia"}, "evento_prueba_000001",
                habilitado=True, urlopen=falso, pausas=(),
            )


if __name__ == "__main__":
    unittest.main()
