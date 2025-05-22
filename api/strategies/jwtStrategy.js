const { SystemRoles } = require('librechat-data-provider');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const { getUserById, updateUser } = require('~/models');
const { logger } = require('~/config');

// Custom extractor to get JWT from query param or Authorization header
const customJwtExtractor = (req) => {
  let token = null;
  // Try to get token from Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }
  // Fallback: try to get token from query parameter
  else if (req.query && req.query.token) {
    token = req.query.token;
  }
  // Fallback: try to get token from cookies (if implemented)
  else if (req.cookies && req.cookies.refreshToken) {
    token = req.cookies.refreshToken;
  }
  // console.log('[JWT Extractor] Extracted token:', token ? token.slice(0, 30) + '...' : null);
  return token;
};

// JWT strategy
const jwtLogin = async () =>
  new JwtStrategy(
    {
      jwtFromRequest: customJwtExtractor,
      secretOrKey: process.env.JWT_SECRET,
    },
    async (payload, done) => {
      try {
        // console.log('[JWT Strategy] Payload:', payload);
        const user = await getUserById(payload?.id, '-password -__v -totpSecret');
        if (user) {
          user.id = user._id.toString();
          if (!user.role) {
            user.role = SystemRoles.USER;
            await updateUser(user.id, { role: user.role });
          }
          done(null, user);
        } else {
          logger.warn('[jwtLogin] JwtStrategy => no user found: ' + payload?.id);
          done(null, false);
        }
      } catch (err) {
        done(err, false);
      }
    },
  );

module.exports = jwtLogin;
