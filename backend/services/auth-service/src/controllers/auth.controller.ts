import { getAuthUser } from '@auction/shared-auth';
import type { RequestHandler } from 'express';
import {
  loginBodySchema,
  refreshTokenBodySchema,
  registerBodySchema,
  updateProfileBodySchema,
} from '../schemas/auth.schemas';
import type { AuthService, TokenPair } from '../services/auth.service';
import { toUserResponse } from './user-response';

function toTokenResponse(tokens: TokenPair) {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: 'Bearer',
    expiresIn: tokens.expiresIn,
  };
}

export function createAuthController(authService: AuthService) {
  const register: RequestHandler = async (req, res) => {
    const user = await authService.register(registerBodySchema.parse(req.body));
    res.status(201).location('/api/v1/users/me').json(toUserResponse(user));
  };

  const login: RequestHandler = async (req, res) => {
    const { user, tokens } = await authService.login(loginBodySchema.parse(req.body));
    res.status(200).json({ ...toTokenResponse(tokens), user: toUserResponse(user) });
  };

  const refresh: RequestHandler = async (req, res) => {
    const { refreshToken } = refreshTokenBodySchema.parse(req.body);
    res.status(200).json(toTokenResponse(await authService.refresh(refreshToken)));
  };

  const logout: RequestHandler = async (req, res) => {
    const { refreshToken } = refreshTokenBodySchema.parse(req.body);
    await authService.logout(refreshToken);
    res.status(204).end();
  };

  const getMe: RequestHandler = async (req, res) => {
    const user = await authService.getProfile(getAuthUser(req).id);
    res.status(200).json(toUserResponse(user));
  };

  const updateMe: RequestHandler = async (req, res) => {
    const input = updateProfileBodySchema.parse(req.body);
    const user = await authService.updateProfile(getAuthUser(req).id, input);
    res.status(200).json(toUserResponse(user));
  };

  return { register, login, refresh, logout, getMe, updateMe };
}
