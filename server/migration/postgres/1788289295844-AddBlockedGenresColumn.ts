import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBlockedGenresColumn1788289295844 implements MigrationInterface {
  name = 'AddBlockedGenresColumn1788289295844';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" ADD "blockedGenres" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "blockedGenres"`);
  }
}
