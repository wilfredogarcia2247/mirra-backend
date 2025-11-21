const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// Cargar .env (para usar el mismo JWT_SECRET que el servidor)
require('dotenv').config();
// Leer .env manualmente para evitar logs de wrappers de dotenv
function readEnvVar(key) {
	try {
		const envPath = path.join(process.cwd(), '.env');
		if (!fs.existsSync(envPath)) return null;
		const content = fs.readFileSync(envPath, 'utf8');
		const lines = content.split(/\r?\n/);
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eq = trimmed.indexOf('=');
			if (eq === -1) continue;
			const k = trimmed.slice(0, eq).trim();
			let v = trimmed.slice(eq + 1).trim();
			if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
				v = v.slice(1, -1);
			}
			if (k === key) return v;
		}
	} catch (e) {
		// ignore
	}
	return null;
}

const secret = process.env.JWT_SECRET || readEnvVar('JWT_SECRET') || 'test_secret';
const token = jwt.sign({ sub: 1, email: 'dev@example.com' }, secret, { expiresIn: '1h' });
// imprimir únicamente el token en stdout para facilitar captura automática
process.stdout.write(token + '\n');
