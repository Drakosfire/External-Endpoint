# LibreChat Security Setup Guide

## 🚨 Critical Security Measures

### 1. MongoDB Authentication
- ✅ MongoDB runs with `--auth` flag
- ✅ Separate users for different services
- ✅ Strong passwords generated with `openssl rand -base64 32`
- ✅ No external MongoDB port exposure

### 2. Network Security
- ✅ MongoDB port 27017 blocked at firewall
- ✅ Services bind to localhost where possible
- ✅ Docker internal networking used
- ✅ No unnecessary port exposure

### 3. Container Security
- ✅ `no-new-privileges:true` security option
- ✅ Read-only filesystems where possible
- ✅ Non-root user execution
- ✅ Health checks for service dependencies

## 🔧 Setup Instructions

### Generate Secure Passwords
```bash
# Generate MongoDB passwords
openssl rand -base64 32  # MONGO_ROOT_PASSWORD
openssl rand -base64 32  # MONGO_PASSWORD

# Generate JWT secrets
openssl rand -base64 32  # JWT_SECRET
openssl rand -base64 32  # JWT_REFRESH_SECRET
```

### Environment Configuration
```bash
# Copy secure template
cp env.secure.example .env

# Edit with your secure values
nano .env
```

### Firewall Configuration
```bash
# Block MongoDB port
sudo ufw deny 27017

# Allow only necessary ports
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3080/tcp  # Only if needed externally
```

## 🏗️ Architecture

### Development (docker-compose.yml)
- Single service with combined frontend/backend
- MongoDB with authentication
- Health checks and proper dependencies
- Local development optimizations

### Production (deploy-compose.yml)
- Separate API and client services
- Nginx reverse proxy
- Enhanced security options
- Production-optimized configuration

## 🔍 Security Verification

### Check MongoDB Security
```bash
# Verify no external MongoDB access
telnet localhost 27017  # Should fail

# Check MongoDB logs
docker logs chat-mongodb | grep -i "auth\|user"

# Test authentication
docker exec chat-mongodb mongosh --eval "db.runCommand('ping')"
```

### Check Container Security
```bash
# Verify security options
docker inspect LibreChat | grep -A 10 "SecurityOpt"

# Check for exposed ports
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

### Check Network Security
```bash
# Verify firewall rules
sudo ufw status

# Check listening ports
sudo netstat -tlnp | grep -E "(27017|3080|80|443)"
```

## 🚨 Incident Response

### If Compromised
1. **Immediate Actions**:
   ```bash
   docker-compose down
   sudo ufw deny 27017
   ```

2. **Investigation**:
   ```bash
   docker logs chat-mongodb
   docker logs LibreChat
   journalctl -u docker
   ```

3. **Recovery**:
   ```bash
   sudo rm -rf ./data-node  # Remove compromised data
   # Regenerate all passwords
   # Restart with new credentials
   ```

## 📋 Security Checklist

- [ ] MongoDB authentication enabled
- [ ] Strong passwords generated
- [ ] Firewall rules configured
- [ ] No unnecessary ports exposed
- [ ] Container security options enabled
- [ ] Health checks implemented
- [ ] Environment variables secured
- [ ] Regular security audits scheduled
- [ ] Backup encryption enabled
- [ ] Monitoring and logging configured

## 🔄 Maintenance

### Regular Security Tasks
- Monthly password rotation
- Quarterly security audits
- Annual penetration testing
- Continuous monitoring of logs
- Regular dependency updates

### Backup Security
```bash
# Encrypted backup example
docker exec chat-mongodb mongodump --out /tmp/backup
tar -czf backup-$(date +%Y%m%d).tar.gz /tmp/backup
gpg -e backup-$(date +%Y%m%d).tar.gz
rm backup-$(date +%Y%m%d).tar.gz
```
