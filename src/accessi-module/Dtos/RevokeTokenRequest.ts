import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RevokeTokenRequest {
  @ApiPropertyOptional({
    description:
      'jti del token da revocare. Se assente viene revocato il token della richiesta corrente. ' +
      'Solo gli amministratori possono revocare un token diverso dal proprio.',
  })
  @IsOptional()
  @IsString()
  jti?: string;
}
