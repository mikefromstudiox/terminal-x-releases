#!/bin/bash
# DGII Receiver VPS Setup Script
# Run: scp this file + server files to VPS, then bash setup-vps.sh

set -e
echo "=== DGII Receiver Setup ==="

# 1. Stop any existing dgii-receiver
echo "[1/6] Stopping existing dgii-receiver..."
pkill -f "node /root/dgii-receiver/server.js" 2>/dev/null || true
sleep 1

# 2. Install dependencies
echo "[2/6] Installing dependencies..."
cd /root/dgii-receiver
npm install --silent 2>/dev/null

# 3. Make the server listen on all interfaces (0.0.0.0)
# so Docker containers can reach it via host IP
echo "[3/6] Server already configured..."

# 4. Update nginx config to use host's real IP
echo "[4/6] Updating nginx config..."
HOSTIP=$(hostname -I | awk '{print $1}')
echo "    Host IP: $HOSTIP"
sed -i "s|proxy_pass http://172\.[0-9]*\.[0-9]*\.[0-9]*:3100|proxy_pass http://${HOSTIP}:3100|g" /opt/mediax/nginx/prod.conf
sed -i "s|proxy_pass http://127\.0\.0\.1:3100|proxy_pass http://${HOSTIP}:3100|g" /opt/mediax/nginx/prod.conf

# Verify config has terminalx
if ! grep -q "fe.terminalxpos.com" /opt/mediax/nginx/prod.conf; then
    echo "ERROR: fe.terminalxpos.com not found in nginx config!"
    exit 1
fi
echo "    nginx config OK"

# 5. Create systemd service for persistence
echo "[5/6] Creating systemd service..."
cat > /etc/systemd/system/dgii-receiver.service << 'SVCEOF'
[Unit]
Description=DGII e-CF Receiver Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/dgii-receiver
ExecStart=/usr/bin/node /root/dgii-receiver/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable dgii-receiver
systemctl restart dgii-receiver
sleep 2

# Check if running
if systemctl is-active --quiet dgii-receiver; then
    echo "    dgii-receiver service: RUNNING"
else
    echo "    ERROR: dgii-receiver failed to start"
    journalctl -u dgii-receiver --no-pager -n 10
    exit 1
fi

# 6. Restart nginx
echo "[6/6] Restarting nginx..."
docker restart mediax-nginx-1
sleep 3

# Test
echo ""
echo "=== Testing endpoints ==="
echo -n "localhost:3100 → "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/fe/autenticacion/api/semilla)
echo "$STATUS"

echo -n "https://fe.terminalxpos.com → "
STATUS=$(curl -sk -o /dev/null -w "%{http_code}" https://fe.terminalxpos.com/fe/autenticacion/api/semilla)
echo "$STATUS"

if [ "$STATUS" = "200" ]; then
    echo ""
    echo "=== SUCCESS ==="
    echo "DGII receiver endpoints are live at https://fe.terminalxpos.com"
    echo ""
    echo "Endpoints:"
    echo "  https://fe.terminalxpos.com/fe/autenticacion/api/semilla"
    echo "  https://fe.terminalxpos.com/fe/autenticacion/api/ValidacionCertificado"
    echo "  https://fe.terminalxpos.com/fe/recepcion/api/ecf"
    echo "  https://fe.terminalxpos.com/fe/aprobacioncomercial/api/ecf"
    echo ""
    echo "Next: Update DGII portal URLs from terminalxpos.com to fe.terminalxpos.com"
else
    echo ""
    echo "=== HTTPS not working yet ==="
    echo "localhost works but HTTPS proxy failed."
    echo "Check: docker exec mediax-nginx-1 nginx -t"
    echo "Check: cat /opt/mediax/nginx/prod.conf | grep terminalx"
    echo "The proxy_pass IP might need adjustment. Current: $HOSTIP"
fi
