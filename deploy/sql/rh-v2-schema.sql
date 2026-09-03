-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "displayName" TEXT,
    "initials" TEXT,
    "matricule" TEXT,
    "phone" TEXT,
    "poste" TEXT,
    "service" TEXT,
    "sapSlpCode" INTEGER,
    "sapSlpName" TEXT,
    "birthDate" TIMESTAMP(3),
    "hireDate" TIMESTAMP(3),
    "exitDate" TIMESTAMP(3),
    "exitReason" TEXT,
    "statutEmploi" TEXT NOT NULL DEFAULT 'actif',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'actif',
    "dateDebut" TIMESTAMP(3) NOT NULL,
    "dateFin" TIMESTAMP(3),
    "essaiFin" TIMESTAMP(3),
    "heuresHebdo" DOUBLE PRECISION NOT NULL DEFAULT 35,
    "heuresAnnuelles" DOUBLE PRECISION NOT NULL DEFAULT 1600,
    "tempsPartiel" BOOLEAN NOT NULL DEFAULT false,
    "classification" TEXT,
    "tauxHoraire" DOUBLE PRECISION,
    "saisonLabel" TEXT,
    "reconductible" BOOLEAN NOT NULL DEFAULT false,
    "motif" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RhTimeClock" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "pauseMin" INTEGER NOT NULL DEFAULT 0,
    "heuresMin" INTEGER NOT NULL DEFAULT 0,
    "statut" TEXT NOT NULL DEFAULT 'ouvert',
    "source" TEXT NOT NULL DEFAULT 'badge',
    "note" TEXT,
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RhTimeClock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RhTimePunch" (
    "id" TEXT NOT NULL,
    "timeClockId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'badge',
    "editedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RhTimePunch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RhWeekSheet" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "isoWeek" TEXT NOT NULL,
    "monthAttrib" TEXT,
    "contractHours" DOUBLE PRECISION NOT NULL DEFAULT 35,
    "option" TEXT,
    "paySuppMin" INTEGER NOT NULL DEFAULT 0,
    "days" TEXT NOT NULL DEFAULT '[]',
    "calc" TEXT,
    "validationStatus" TEXT NOT NULL DEFAULT 'draft',
    "validationData" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RhWeekSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RhAnnualCounter" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "heuresTheo" DOUBLE PRECISION NOT NULL DEFAULT 1600,
    "heuresRealisees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "soldeModulMin" INTEGER NOT NULL DEFAULT 0,
    "heuresSuppAnnee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contingentUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "regulDue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RhAnnualCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RhLeaveRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'pending',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "jours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "demiJournee" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'salarie',
    "note" TEXT,
    "decisionNote" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "justificatifId" TEXT,
    "justified" BOOLEAN NOT NULL DEFAULT false,
    "history" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RhLeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RhLeaveBalance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodeRef" TEXT NOT NULL,
    "cpAcquis" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cpPris" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cpSolde" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recupSoldeMin" INTEGER NOT NULL DEFAULT 0,
    "recupCapMin" INTEGER NOT NULL DEFAULT 0,
    "ancienneteJours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RhLeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RhHoliday" (
    "date" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "region" TEXT,
    "worked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RhHoliday_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "RhPayrollElement" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "mois" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "montant" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "meta" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'saisi',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RhPayrollElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RhPayrollSend" (
    "id" TEXT NOT NULL,
    "mois" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'normal',
    "filename" TEXT,
    "to" TEXT NOT NULL DEFAULT '[]',
    "sentBy" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RhPayrollSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RhDocument" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT,
    "type" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "mime" TEXT,
    "contenu" TEXT NOT NULL,
    "visibleSalarie" BOOLEAN NOT NULL DEFAULT true,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RhDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RhEvent" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "meta" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RhEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RhReglement" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "dateEffet" TIMESTAMP(3) NOT NULL,
    "label" TEXT,
    "params" TEXT NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RhReglement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_matricule_key" ON "Employee"("matricule");

-- CreateIndex
CREATE INDEX "Employee_statutEmploi_idx" ON "Employee"("statutEmploi");

-- CreateIndex
CREATE INDEX "Employee_sapSlpName_idx" ON "Employee"("sapSlpName");

-- CreateIndex
CREATE INDEX "Employee_hireDate_idx" ON "Employee"("hireDate");

-- CreateIndex
CREATE INDEX "Contract_employeeId_idx" ON "Contract"("employeeId");

-- CreateIndex
CREATE INDEX "Contract_statut_idx" ON "Contract"("statut");

-- CreateIndex
CREATE INDEX "Contract_type_idx" ON "Contract"("type");

-- CreateIndex
CREATE INDEX "Contract_dateFin_idx" ON "Contract"("dateFin");

-- CreateIndex
CREATE INDEX "Contract_essaiFin_idx" ON "Contract"("essaiFin");

-- CreateIndex
CREATE INDEX "RhTimeClock_date_idx" ON "RhTimeClock"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RhTimeClock_employeeId_date_key" ON "RhTimeClock"("employeeId", "date");

-- CreateIndex
CREATE INDEX "RhTimePunch_timeClockId_idx" ON "RhTimePunch"("timeClockId");

-- CreateIndex
CREATE INDEX "RhTimePunch_at_idx" ON "RhTimePunch"("at");

-- CreateIndex
CREATE INDEX "RhWeekSheet_monthAttrib_idx" ON "RhWeekSheet"("monthAttrib");

-- CreateIndex
CREATE UNIQUE INDEX "RhWeekSheet_employeeId_isoWeek_key" ON "RhWeekSheet"("employeeId", "isoWeek");

-- CreateIndex
CREATE INDEX "RhAnnualCounter_periodEnd_idx" ON "RhAnnualCounter"("periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "RhAnnualCounter_employeeId_periodStart_key" ON "RhAnnualCounter"("employeeId", "periodStart");

-- CreateIndex
CREATE INDEX "RhLeaveRequest_employeeId_idx" ON "RhLeaveRequest"("employeeId");

-- CreateIndex
CREATE INDEX "RhLeaveRequest_statut_idx" ON "RhLeaveRequest"("statut");

-- CreateIndex
CREATE INDEX "RhLeaveRequest_startDate_idx" ON "RhLeaveRequest"("startDate");

-- CreateIndex
CREATE UNIQUE INDEX "RhLeaveBalance_employeeId_periodeRef_key" ON "RhLeaveBalance"("employeeId", "periodeRef");

-- CreateIndex
CREATE INDEX "RhPayrollElement_employeeId_mois_idx" ON "RhPayrollElement"("employeeId", "mois");

-- CreateIndex
CREATE INDEX "RhPayrollElement_mois_idx" ON "RhPayrollElement"("mois");

-- CreateIndex
CREATE INDEX "RhPayrollSend_mois_idx" ON "RhPayrollSend"("mois");

-- CreateIndex
CREATE INDEX "RhDocument_employeeId_idx" ON "RhDocument"("employeeId");

-- CreateIndex
CREATE INDEX "RhDocument_type_idx" ON "RhDocument"("type");

-- CreateIndex
CREATE INDEX "RhEvent_employeeId_idx" ON "RhEvent"("employeeId");

-- CreateIndex
CREATE INDEX "RhEvent_type_idx" ON "RhEvent"("type");

-- CreateIndex
CREATE INDEX "RhEvent_date_idx" ON "RhEvent"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RhReglement_version_key" ON "RhReglement"("version");

-- CreateIndex
CREATE INDEX "RhReglement_dateEffet_idx" ON "RhReglement"("dateEffet");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RhTimeClock" ADD CONSTRAINT "RhTimeClock_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RhTimePunch" ADD CONSTRAINT "RhTimePunch_timeClockId_fkey" FOREIGN KEY ("timeClockId") REFERENCES "RhTimeClock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RhWeekSheet" ADD CONSTRAINT "RhWeekSheet_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RhAnnualCounter" ADD CONSTRAINT "RhAnnualCounter_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RhLeaveRequest" ADD CONSTRAINT "RhLeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RhLeaveBalance" ADD CONSTRAINT "RhLeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RhPayrollElement" ADD CONSTRAINT "RhPayrollElement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RhDocument" ADD CONSTRAINT "RhDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RhEvent" ADD CONSTRAINT "RhEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

