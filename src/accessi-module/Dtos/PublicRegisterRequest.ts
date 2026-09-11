import { OmitType } from '@nestjs/swagger';
import { RegisterRequest } from './RegisterRequest';

export class PublicRegisterRequest extends OmitType(RegisterRequest, [
  'flagSuper',
  'flagAdminConfigurator',
  'flagDueFattori',
  'roles',
  'permissions',
] as const) {}
