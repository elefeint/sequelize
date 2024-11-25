'use strict';

const Support = require('../../support');
const { DataTypes } = require('@sequelize/core');

const expectsql = Support.expectsql;
const current = Support.sequelize;
const sql = current.dialect.queryGenerator;

describe(Support.getTestDialectTeaser('SQL'), () => {
  if (current.dialect.name === 'snowflake') {
    return;
  }

  describe('createTable', () => {
    describe('with enums', () => {
      it('references enum in the right schema #3171', () => {
        const FooUser = current.define(
          'user',
          {
            mood: DataTypes.ENUM('happy', 'sad'),
          },
          {
            schema: 'foo',
            timestamps: false,
          },
        );

        expectsql(
          sql.createTableQuery(FooUser.table, sql.attributesToSQL(FooUser.getAttributes()), {}),
          {
            sqlite3:
              'CREATE TABLE IF NOT EXISTS `foo.users` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `mood` TEXT);',
            db2: 'CREATE TABLE IF NOT EXISTS "foo"."users" ("id" INTEGER NOT NULL GENERATED BY DEFAULT AS IDENTITY(START WITH 1, INCREMENT BY 1) , "mood" VARCHAR(255) CHECK ("mood" IN(\'happy\', \'sad\')), PRIMARY KEY ("id"));',
            postgres:
              'CREATE TABLE IF NOT EXISTS "foo"."users" ("id"   SERIAL , "mood" "foo"."enum_users_mood", PRIMARY KEY ("id"));',
            'mariadb mysql':
              "CREATE TABLE IF NOT EXISTS `foo`.`users` (`id` INTEGER NOT NULL auto_increment , `mood` ENUM('happy', 'sad'), PRIMARY KEY (`id`)) ENGINE=InnoDB;",
            mssql: `IF OBJECT_ID(N'[foo].[users]', 'U') IS NULL CREATE TABLE [foo].[users] ([id] INTEGER NOT NULL IDENTITY(1,1) , [mood] NVARCHAR(255) CHECK ([mood] IN(N'happy', N'sad')), PRIMARY KEY ([id]));`,
            ibmi: `BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE VALUE '42710'
      BEGIN END;
      CREATE TABLE "foo"."users" ("id" INTEGER NOT NULL GENERATED BY DEFAULT AS IDENTITY (START WITH 1, INCREMENT BY 1) , "mood" VARCHAR(255) CHECK ("mood" IN('happy', 'sad')), PRIMARY KEY ("id"));
      END`,
            duckdb: 'CREATE SEQUENCE IF NOT EXISTS "foo_users_id_seq" START 1; CREATE TABLE IF NOT EXISTS "foo"."users" ("id" INTEGER NOT NULL DEFAULT nextval(\'foo_users_id_seq\'), "mood" ENUM(\'happy\', \'sad\')); COMMENT ON COLUMN "foo"."users"."id" IS \'PRIMARY KEY\';'
          },
        );
      });
    });

    describe('with references', () => {
      it('references right schema when adding foreign key #9029', () => {
        const BarUser = current.define('user', {}, { timestamps: false }).withSchema('bar');

        const BarProject = current
          .define(
            'project',
            {
              user_id: {
                type: DataTypes.INTEGER,
                references: { model: BarUser },
                onUpdate: 'CASCADE',
                onDelete: 'NO ACTION',
              },
            },
            {
              timestamps: false,
            },
          )
          .withSchema('bar');

        BarProject.belongsTo(BarUser, { foreignKey: 'user_id' });

        expectsql(
          sql.createTableQuery(
            BarProject.table,
            sql.attributesToSQL(BarProject.getAttributes()),
            {},
          ),
          {
            sqlite3:
              'CREATE TABLE IF NOT EXISTS `bar.projects` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `user_id` INTEGER REFERENCES `bar.users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE);',
            db2: 'CREATE TABLE IF NOT EXISTS "bar"."projects" ("id" INTEGER NOT NULL GENERATED BY DEFAULT AS IDENTITY(START WITH 1, INCREMENT BY 1) , "user_id" INTEGER, PRIMARY KEY ("id"), FOREIGN KEY ("user_id") REFERENCES "bar"."users" ("id") ON DELETE NO ACTION);',
            postgres:
              'CREATE TABLE IF NOT EXISTS "bar"."projects" ("id"   SERIAL , "user_id" INTEGER REFERENCES "bar"."users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE, PRIMARY KEY ("id"));',
            'mariadb mysql':
              'CREATE TABLE IF NOT EXISTS `bar`.`projects` (`id` INTEGER NOT NULL auto_increment , `user_id` INTEGER, PRIMARY KEY (`id`), FOREIGN KEY (`user_id`) REFERENCES `bar`.`users` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE) ENGINE=InnoDB;',
            mssql: `IF OBJECT_ID(N'[bar].[projects]', 'U') IS NULL CREATE TABLE [bar].[projects] ([id] INTEGER NOT NULL IDENTITY(1,1) , [user_id] INTEGER NULL, PRIMARY KEY ([id]), FOREIGN KEY ([user_id]) REFERENCES [bar].[users] ([id]) ON DELETE NO ACTION);`,
            ibmi: `BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE VALUE '42710'
      BEGIN END;
      CREATE TABLE "bar"."projects" ("id" INTEGER NOT NULL GENERATED BY DEFAULT AS IDENTITY (START WITH 1, INCREMENT BY 1) , "user_id" INTEGER REFERENCES "bar"."users" ("id") ON DELETE NO ACTION, PRIMARY KEY ("id"));
      END`,
            duckdb: 'CREATE SEQUENCE IF NOT EXISTS "bar_projects_id_seq" START 1; CREATE TABLE IF NOT EXISTS "bar"."projects" ("id" INTEGER NOT NULL DEFAULT nextval(\'bar_projects_id_seq\'), "user_id" INTEGER); COMMENT ON COLUMN "bar"."projects"."id" IS \'PRIMARY KEY\';'
          },
        );
      });
    });

    describe('with references on primary key', () => {
      it('references on primary key #9461', () => {
        const File = current.define('file', {}, { timestamps: false });
        const Image = current.define(
          'image',
          {
            id: {
              primaryKey: true,
              autoIncrement: true,
              type: DataTypes.INTEGER,
              references: {
                model: File,
                key: 'id',
              },
            },
          },
          {
            timestamps: false,
          },
        );

        expectsql(
          sql.createTableQuery(Image.table, sql.attributesToSQL(Image.getAttributes()), {}),
          {
            sqlite3:
              'CREATE TABLE IF NOT EXISTS `images` (`id` INTEGER PRIMARY KEY AUTOINCREMENT REFERENCES `files` (`id`));',
            postgres:
              'CREATE TABLE IF NOT EXISTS "images" ("id"  SERIAL  REFERENCES "files" ("id"), PRIMARY KEY ("id"));',
            db2: 'CREATE TABLE IF NOT EXISTS "images" ("id" INTEGER NOT NULL GENERATED BY DEFAULT AS IDENTITY(START WITH 1, INCREMENT BY 1) , PRIMARY KEY ("id"), FOREIGN KEY ("id") REFERENCES "files" ("id"));',
            mariadb:
              'CREATE TABLE IF NOT EXISTS `images` (`id` INTEGER auto_increment , PRIMARY KEY (`id`), FOREIGN KEY (`id`) REFERENCES `files` (`id`)) ENGINE=InnoDB;',
            mysql:
              'CREATE TABLE IF NOT EXISTS `images` (`id` INTEGER auto_increment , PRIMARY KEY (`id`), FOREIGN KEY (`id`) REFERENCES `files` (`id`)) ENGINE=InnoDB;',
            mssql: `IF OBJECT_ID(N'[images]', 'U') IS NULL CREATE TABLE [images] ([id] INTEGER IDENTITY(1,1) , PRIMARY KEY ([id]), FOREIGN KEY ([id]) REFERENCES [files] ([id]));`,
            ibmi: `BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE VALUE '42710'
      BEGIN END;
      CREATE TABLE "images" ("id" INTEGER GENERATED BY DEFAULT AS IDENTITY (START WITH 1, INCREMENT BY 1)  REFERENCES "files" ("id"), PRIMARY KEY ("id"));
      END`,
            duckdb:
                'CREATE SEQUENCE IF NOT EXISTS "images_id_seq" START 1; CREATE TABLE IF NOT EXISTS "images" ("id" INTEGER DEFAULT nextval(\'images_id_seq\')); COMMENT ON COLUMN "images"."id" IS \'PRIMARY KEY\';',
          },
        );
      });
    });
  });
});
