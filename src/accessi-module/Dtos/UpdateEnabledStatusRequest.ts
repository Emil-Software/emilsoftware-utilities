import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateEnabledStatusRequest {
  @ApiProperty({
    description: 'Nuovo stato di abilitazione',
    example: true,
    type: Boolean,
  })
  @IsBoolean({ message: 'Il valore di enabled deve essere booleano.' })
  enabled: boolean;
}
