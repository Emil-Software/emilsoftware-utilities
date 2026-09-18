import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ValidateNested } from "class-validator";
import { AbilitazioneMenu } from "./AbilitazioneMenu";
import { Role } from "./Role";

export class UserGrantsDto {
    @ApiProperty({ description: 'Abilitazioni dell\'utente', type: [AbilitazioneMenu] })
    @ValidateNested({ each: true })
    @Type(() => AbilitazioneMenu)
    abilitazioni!: AbilitazioneMenu[];
  
    @ApiProperty({ description: 'Ruoli dell\'utente', type: [Role] })
    @ValidateNested({ each: true })
    @Type(() => Role)
    ruoli!: Role[];
  
    @ApiProperty({ description: 'Grants combinati', type: [AbilitazioneMenu] })
    @ValidateNested({ each: true })
    @Type(() => AbilitazioneMenu)
    grants!: AbilitazioneMenu[];
  }