# Impersonation (`z_button.impersonate`), in a text section of its own after the game's, as game/dol.ts (impersonate) adds it.
# Position-independent like gun.s: game functions are called through ctr and `data` is found from the pc.
#   powerpc-eabi-as -mgekko -mregnames -o impersonate.o impersonate.s
#   powerpc-eabi-ld -Ttext=0x80700000 -e imp_frame \
#     --defsym z_update=0x80137494 --defsym stealth_test=0x801377CC --defsym fn_80434900=0x80434900 \
#     --defsym fn_804317BC=0x804317BC --defsym fn_8042FF2C=0x8042FF2C --defsym fn_80433D20=0x80433D20 --defsym fn_80433D70=0x80433D70 \
#     --defsym fn_8009D71C=0x8009D71C --defsym fn_80443908=0x80443908 --defsym fn_8008F53C=0x8008F53C \
#     --defsym fn_801A479C=0x801A479C --defsym fn_801A4290=0x801A4290 --defsym lbl_805432E0=0x805432E0 \
#     -o impersonate.elf impersonate.o
#   powerpc-eabi-objcopy -O binary -j .text impersonate.elf impersonate.bin
# While Z holds a live slot (zactions.s) with flag MOVES, MODEL or STATS, its human player takes on the other player's:
# - STATS: the tuning fields `data`'s bitmap marks (regen recached by fn_8009D71C), max health at the same fraction, and
#   the lift bits of +0x308.
# - MOVES: the motion set (+0x1C0, a reference taken), every other tuning field, the ability bits of +0x308, and the type
#   ID (+0x1AC) while a sound event plays. It switches only while the player stands, walks or runs (or a cutscene plays).
#   Across body classes (+0x200) a context renumbers the opponent's clips onto the player's bones as they're sampled, and
#   throws stay the player's own on both sides.
# - MODEL: the opponent's model and shadow, drawn in place of the player's with a palette built from the player's pose.
# An opponent who impersonates too gives their saved values. Everything is undone on release, and before either actor is
# released (fn_80097614).
# `data`: {RECS x record, u8 stat field bitmap[32] (field f is bit f & 7 of byte f >> 3), u8 base nodes[3] of the body
# classes, pad, u8 maps[3][3][MAPLEN] (opponent class, player class: the player's node for each of the opponent's base
# nodes, 0xff for its parent's rotation), u8 throw state bitmap[48], u8 clip maps[3][3][AMAPLEN] (clip class, player class:
# the player's bone for each of the clip's, 0xff to drop its tracks), 2 x context, the clip map being sampled}, written by
# dol.ts. A context: {actor, opponent, the actor's model resource, the opponent's motion set, the actor's own, clip map}.
# A record: {actor, opponent, u32 clock ms it was last updated, u32 parts on, own motion set, the opponent's set it took,
# own ability bits, own lift bits, f32 own max health, the opponent's type ID, pad}.
	.text
	.globl imp_frame, imp_tuning, imp_int, imp_name, imp_voice, imp_release, imp_track, imp_clip, imp_play, imp_draw, imp_shadow, imp_clip2, imp_track2, imp_word
	.set MOVES, 2048            # zTable's flags
	.set MODEL, 4096
	.set STATS, 8192
	.set ALL, MOVES | MODEL | STATS
	.set ON_MOVES, 1
	.set ON_MODEL, 2
	.set ON_STATS, 4
	.set RECS, 2
	.set REC, 0x30
	.set R_ACTOR, 0
	.set R_OPP, 4
	.set R_STAMP, 8
	.set R_ON, 0xc
	.set R_SET, 0x10
	.set R_OPPSET, 0x14
	.set R_ABIL, 0x18
	.set R_LIFT, 0x1c
	.set R_MAX, 0x20
	.set R_TYPE, 0x24
	.set STATBITS, RECS * REC
	.set BASES, STATBITS + 32
	.set MAPS, BASES + 4
	.set MAPLEN, 80
	.set THROWBITS, MAPS + 9 * MAPLEN
	.set AMAPS, THROWBITS + 48
	.set AMAPLEN, 88
	.set CTX, AMAPS + 9 * AMAPLEN
	.set CTXLEN, 0x18
	.set C_ACTOR, 0
	.set C_OPP, 4
	.set C_RES, 8
	.set C_OPPSET, 0xc
	.set C_OWNSET, 0x10
	.set C_MAP, 0x14
	.set CUR, CTX + 2 * CTXLEN
	.set ON_CROSS, 8
	.set LIFT, 0x30
	.set ABIL_HI, 0x2410        # flight 0x1 and 0x100000, wall climb 0x2, wall run 0x4000000, wire 0x80,
	.set ABIL_LO, 0x2083        # long grab 0x2000, weapon return 0x20000000
	.set STAND, 2               # controller states (+0x8) Stand, Walk and Run
	.set FRESH, 250             # ms a record stays live without an update
	.set FAKE, 0x10             # draw frame: the stand-in instance, the drawn instance's saved +0x68 and +0x48,
	.set SAVE, 0x80             # the skinned streams of it and its linked instances, then the palette
	.set STREAMS, 0xd0
	.set PAL, STREAMS + 5 * 0x20

	.macro call fn
	lis r12, \fn@ha
	addi r12, r12, \fn@l
	mtctr r12
	bctrl
	.endm

	.macro jump to
	lis r12, \to@ha
	addi r12, r12, \to@l
	mtctr r12
	bctr
	.endm

	.macro clock reg
	lis \reg, 0x8059
	lwz \reg, 0x3c2c(\reg)
	.endm

# From fn_800FB944 in place of zactions.s's bl z_update (r29 = the human input object): Z's actions, then this player's
# impersonation brought in line with what its slot asks for.
imp_frame:
	stwu r1, -0x50(r1)
	mflr r0
	stw r0, 0x54(r1)
	stmw r22, 0x28(r1)
	call z_update
	lwz r28, 0x5b4(r29)
	cmpwi r28, 0
	beq 99f
	lwz r30, 0xe4(r28)
	cmpwi r30, 0
	beq 99f
	mr r4, r30
	li r5, ALL
	call stealth_test
	li r27, 0
	cmpwi r0, 0
	beq 1f
	lwz r27, 12(r9)
	andi. r27, r27, ALL
1:	mr r3, r30
	bl find_any
	mr. r26, r9
	bne 2f
	cmpwi r27, 0
	beq 99f
	bl claim
	cmpwi r26, 0
	beq 99f
2:	clock r9
	stw r9, R_STAMP(r26)
	lwz r25, R_OPP(r26)
	lwz r24, R_ON(r26)
	andi. r0, r27, STATS
	beq 3f
	andi. r0, r24, ON_STATS
	bne 4f
	bl stats_on
	b 4f
3:	andi. r0, r24, ON_STATS
	beq 4f
	bl stats_off
4:	lwz r24, R_ON(r26)
	rlwinm r24, r24, 0, 31, 29
	andi. r0, r27, MODEL
	beq 5f
	ori r24, r24, ON_MODEL
5:	stw r24, R_ON(r26)
	lbz r23, 8(r28)
	addi r23, r23, -STAND
	lis r9, lbl_805432E0@ha
	lwz r0, (lbl_805432E0 + 0x9c)@l(r9)
	lwz r9, (lbl_805432E0 + 0xa0)@l(r9)
	cmplw r0, r9
	ble 6f
	li r23, 0                   # a cutscene plays
6:	andi. r0, r27, MOVES
	beq 7f
	andi. r0, r24, ON_MOVES
	bne 8f
	cmplwi r23, 2
	bgt 8f
	bl moves_on
	b 8f
7:	andi. r0, r24, ON_MOVES
	beq 8f
	cmplwi r23, 2
	bgt 8f
	bl moves_off
8:	lwz r0, R_ON(r26)
	or. r0, r0, r27
	bne 99f
	stw r0, R_ACTOR(r26)
99:	lmw r22, 0x28(r1)
	lwz r0, 0x54(r1)
	mtlr r0
	addi r1, r1, 0x50
	blr

# r26 = a free record (else one not updated for a while) for r30 and its opponent, the first other player, or 0 when there
# is none. Uses r22, r24 and the volatile registers.
claim:
	mflr r22
	bl here
	clock r10
	li r0, RECS
	mtctr r0
	mr r9, r11
1:	lwz r0, R_ACTOR(r9)
	cmpwi r0, 0
	beq 3f
	addi r9, r9, REC
	bdnz 1b
	li r0, RECS
	mtctr r0
	mr r9, r11
2:	lwz r0, R_STAMP(r9)
	subf r0, r0, r10
	cmplwi r0, FRESH
	bge 3f
	addi r9, r9, REC
	bdnz 2b
	li r26, 0
	mtlr r22
	blr
3:	mr r26, r9
	li r0, 0
	li r9, REC / 4
	mtctr r9
	addi r9, r26, -4
4:	stwu r0, 4(r9)
	bdnz 4b
	li r24, 0
5:	lis r3, 0x8055
	addi r3, r3, 0x2110
	call fn_80434900
	cmpw r24, r3
	bge 6f
	lis r3, 0x8055
	addi r3, r3, 0x2110
	mr r4, r24
	call fn_804317BC
	call fn_8042FF2C
	addi r24, r24, 1
	cmpwi r3, 0
	beq 5b
	cmpw r3, r30
	beq 5b
	stw r3, R_OPP(r26)
	stw r30, R_ACTOR(r26)
	mtlr r22
	blr
6:	li r26, 0
	mtlr r22
	blr

# r9 = actor r3's record, or 0; r11 = data. Uses r0, r10, r12, ctr.
find_any:
	mflr r12
	bl here
	mtlr r12
	li r0, RECS
	mtctr r0
	mr r9, r11
1:	lwz r0, R_ACTOR(r9)
	cmpw r0, r3
	beqlr
	addi r9, r9, REC
	bdnz 1b
	li r9, 0
	blr

# r9 = actor r3's record if updated within FRESH ms, or 0; r11 = data. Uses r0, r10, r12, ctr.
find:
	mflr r12
	bl here
	mtlr r12
	clock r10
	li r0, RECS
	mtctr r0
	mr r9, r11
1:	lwz r0, R_ACTOR(r9)
	cmpw r0, r3
	bne 2f
	lwz r0, R_STAMP(r9)
	subf r0, r0, r10
	cmplwi r0, FRESH
	bltlr
2:	addi r9, r9, REC
	bdnz 1b
	li r9, 0
	blr

# r9 = the live record with MODEL on whose actor's model is r3, or 0. Uses r0, r10-r12, ctr.
find_model:
	mflr r12
	bl here
	mtlr r12
	clock r10
	li r0, RECS
	mtctr r0
	mr r9, r11
1:	lwz r12, R_ACTOR(r9)
	cmpwi r12, 0
	beq 2f
	lwz r0, R_ON(r9)
	andi. r0, r0, ON_MODEL
	beq 2f
	lwz r12, 0x1bc(r12)
	cmpw r12, r3
	bne 2f
	lwz r0, R_STAMP(r9)
	subf r0, r0, r10
	cmplwi r0, FRESH
	bltlr
2:	addi r9, r9, REC
	bdnz 1b
	li r9, 0
	blr

# r3 = actor r3's +0x308 with the bits its own impersonation changed put back. Uses r0, r8-r12, ctr.
orig308:
	mflr r8
	lwz r10, 0x308(r3)
	bl find_any
	mtlr r8
	cmpwi r9, 0
	beq 9f
	lwz r0, R_ON(r9)
	andi. r12, r0, ON_STATS
	beq 1f
	rlwinm r10, r10, 0, 28, 25
	lwz r12, R_LIFT(r9)
	or r10, r10, r12
1:	andi. r12, r0, ON_MOVES
	beq 9f
	lis r12, ABIL_HI
	ori r12, r12, ABIL_LO
	andc r10, r10, r12
	lwz r12, R_ABIL(r9)
	or r10, r10, r12
9:	mr r3, r10
	blr

# r30's max health from f1 to f2, its health kept at the same fraction.
rescale:
	fsubs f0, f1, f1
	fcmpu cr0, f1, f0
	ble 1f
	fdivs f3, f2, f1
	lfs f0, 0x31c(r30)
	fmuls f0, f0, f3
	stfs f0, 0x31c(r30)
	lfs f0, 0x32c(r30)
	fmuls f0, f0, f3
	stfs f0, 0x32c(r30)
1:	stfs f2, 0x320(r30)
	blr

# Record r26 (actor r30, opponent r25) takes the opponent's stats. Uses r23 and the volatile registers.
stats_on:
	mflr r23
	lwz r0, 0x308(r30)
	andi. r0, r0, LIFT
	stw r0, R_LIFT(r26)
	mr r3, r25
	bl orig308
	andi. r3, r3, LIFT
	lwz r0, 0x308(r30)
	rlwinm r0, r0, 0, 28, 25
	or r0, r0, r3
	stw r0, 0x308(r30)
	lfs f2, 0x320(r25)
	mr r3, r25
	bl find_any
	cmpwi r9, 0
	beq 1f
	lwz r0, R_ON(r9)
	andi. r0, r0, ON_STATS
	beq 1f
	lfs f2, R_MAX(r9)
1:	lfs f1, 0x320(r30)
	stfs f1, R_MAX(r26)
	bl rescale
	lwz r0, R_ON(r26)
	ori r0, r0, ON_STATS
	stw r0, R_ON(r26)
	mr r3, r30
	call fn_8009D71C
	mtlr r23
	blr

# Record r26 (actor r30) gives its stats back. Uses r23 and the volatile registers.
stats_off:
	mflr r23
	lwz r0, R_ON(r26)
	rlwinm r0, r0, 0, 30, 28
	stw r0, R_ON(r26)
	lwz r0, 0x308(r30)
	rlwinm r0, r0, 0, 28, 25
	lwz r9, R_LIFT(r26)
	or r0, r0, r9
	stw r0, 0x308(r30)
	lfs f1, 0x320(r30)
	lfs f2, R_MAX(r26)
	bl rescale
	mr r3, r30
	call fn_8009D71C
	mtlr r23
	blr

# Record r26 (actor r30, opponent r25) takes the opponent's moves if they have another motion set, with a context across
# body classes. Uses r22, r23 and the volatile registers.
moves_on:
	mflr r23
	lwz r22, 0x1c0(r25)
	mr r3, r25
	bl find_any
	cmpwi r9, 0
	beq 1f
	lwz r0, R_ON(r9)
	andi. r0, r0, ON_MOVES
	beq 1f
	lwz r22, R_SET(r9)
1:	cmpwi r22, 0
	beq 9f
	lwz r0, 0x1c0(r30)
	cmpw r0, r22
	beq 9f
	stw r0, R_SET(r26)
	stw r22, R_OPPSET(r26)
	mr r3, r22
	call fn_80443908
	stw r22, 0x1c0(r30)
	mr r3, r25
	bl orig308
	lis r9, ABIL_HI
	ori r9, r9, ABIL_LO
	and r3, r3, r9
	lwz r0, 0x308(r30)
	and r10, r0, r9
	stw r10, R_ABIL(r26)
	andc r0, r0, r9
	or r0, r0, r3
	stw r0, 0x308(r30)
	lwz r0, 0x1ac(r25)
	stw r0, R_TYPE(r26)
	lwz r0, R_ON(r26)
	ori r0, r0, ON_MOVES
	stw r0, R_ON(r26)
	lwz r3, 0x200(r30)
	lwz r4, 0x200(r25)
	cmpw r3, r4
	beq 9f
	lwz r5, 0x1bc(r30)
	cmpwi r5, 0
	beq 9f
	lwz r5, 0(r5)
	cmplwi r3, 2
	ble 1f
	li r3, 0
1:	cmplwi r4, 2
	ble 2f
	li r4, 0
2:	bl here
	mulli r4, r4, 3
	add r4, r4, r3
	mulli r4, r4, AMAPLEN
	addi r4, r4, AMAPS
	add r4, r11, r4
	addi r9, r11, CTX
	li r10, 0
	li r0, 2
	mtctr r0
3:	lwz r0, C_ACTOR(r9)
	cmpw r0, r30
	beq 5f
	cmpwi r0, 0
	bne 4f
	mr r10, r9
4:	addi r9, r9, CTXLEN
	bdnz 3b
	mr r9, r10
	cmpwi r9, 0
	bne 5f
	addi r9, r11, CTX
5:	stw r30, C_ACTOR(r9)
	stw r25, C_OPP(r9)
	stw r5, C_RES(r9)
	stw r22, C_OPPSET(r9)
	lwz r0, R_SET(r26)
	stw r0, C_OWNSET(r9)
	stw r4, C_MAP(r9)
	lwz r0, R_ON(r26)
	ori r0, r0, ON_CROSS
	stw r0, R_ON(r26)
9:	mtlr r23
	blr

# Record r26 (actor r30) gives the opponent's moves back. Uses r23 and the volatile registers.
moves_off:
	mflr r23
	lwz r0, R_ON(r26)
	rlwinm r0, r0, 0, 0, 30
	rlwinm r0, r0, 0, 29, 27
	stw r0, R_ON(r26)
	lwz r3, R_OPPSET(r26)
	lwz r0, 0x1c0(r30)
	cmpw r0, r3
	bne 1f
	lwz r0, R_SET(r26)
	stw r0, 0x1c0(r30)
1:	call fn_8008F53C
	lis r9, ABIL_HI
	ori r9, r9, ABIL_LO
	lwz r0, 0x308(r30)
	andc r0, r0, r9
	lwz r10, R_ABIL(r26)
	or r0, r0, r10
	stw r0, 0x308(r30)
	mtlr r23
	blr

# Record r26 (actor r30) gives back everything and is freed. Uses r23, r24 and the volatile registers.
restore_all:
	mflr r24
	lwz r0, R_ON(r26)
	andi. r0, r0, ON_STATS
	beq 1f
	bl stats_off
1:	lwz r0, R_ON(r26)
	andi. r0, r0, ON_MOVES
	beq 2f
	bl moves_off
2:	li r0, 0
	stw r0, R_ON(r26)
	stw r0, R_ACTOR(r26)
	mtlr r24
	blr

# r0 = 1 when tuning field r4 of entity r3 is the opponent's (a stat field with STATS on, another with MOVES on): r10 =
# the opponent, r12 = their record, r5 = the slot (theirs if 5, costume 2, else r3's, with 5 as 0). Uses r0, r5-r12, ctr.
redirect:
	mflr r7
	bl find
	mtlr r7
	li r0, 0
	cmpwi r9, 0
	beqlr
	lwz r10, R_ON(r9)
	andi. r6, r10, ON_MOVES | ON_STATS
	beqlr
	li r6, ON_MOVES
	cmplwi r4, 255
	bgt 1f
	srwi r12, r4, 3
	addi r12, r12, STATBITS
	lbzx r12, r11, r12
	clrlwi r6, r4, 29
	srw r12, r12, r6
	andi. r12, r12, 1
	li r6, ON_MOVES
	beq 1f
	li r6, ON_STATS
1:	and. r6, r10, r6
	beqlr
	lwz r10, R_OPP(r9)
	lwz r12, 0x16c(r10)
	cmpwi r12, 0
	beqlr
	lwz r5, 0x170(r10)
	cmpwi r5, 5
	beq 2f
	lwz r5, 0x170(r3)
	cmpwi r5, 5
	bne 2f
	li r5, 0
2:	li r0, 1
	blr

# fn_800B1884 (float tuning field r4 of entity r3), in place of its first instruction: the opponent's when `redirect` says.
imp_tuning:
	mflr r8
	bl redirect
	mtlr r8
	cmpwi r0, 0
	beq 9f
	mr r3, r12
	jump fn_80433D20
9:	addi r0, r4, -22
	jump 0x800B1888

# fn_800B18EC (integer tuning field r4 of entity r3), in place of its first instruction: the same.
imp_int:
	mflr r8
	bl redirect
	mtlr r8
	cmpwi r0, 0
	beq 9f
	mr r3, r12
	jump fn_80433D70
9:	stwu r1, -0x18(r1)
	jump 0x800B18F0

# fn_800ACD20 (named tuning field r4 of entity r3: projectiles, effects), in place of its first instruction: asked of the
# opponent when `redirect` says, so their costume picks the names.
imp_name:
	mflr r8
	bl redirect
	mtlr r8
	cmpwi r0, 0
	beq 9f
	mr r3, r10
9:	stwu r1, -0x18(r1)
	jump 0x800ACD24

# fn_8010CDCC (sound event r4 of actor r3, args to r9), in place of its first instruction: played with the opponent's type
# ID, so from their bank, while the actor has MOVES on.
imp_voice:
	stwu r1, -0x40(r1)
	mflr r0
	stw r0, 0x44(r1)
	stw r3, 0x8(r1)
	stw r4, 0xc(r1)
	stw r5, 0x10(r1)
	stw r6, 0x14(r1)
	stw r7, 0x18(r1)
	stw r8, 0x1c(r1)
	stw r9, 0x20(r1)
	bl find
	cmpwi r9, 0
	beq 1f
	lwz r0, R_ON(r9)
	andi. r0, r0, ON_MOVES
	beq 1f
	lwz r0, 0x1ac(r3)
	stw r0, 0x24(r1)
	lwz r0, R_TYPE(r9)
	stw r0, 0x1ac(r3)
	bl reload
	bl voice
	lwz r9, 0x8(r1)
	lwz r0, 0x24(r1)
	stw r0, 0x1ac(r9)
	lwz r0, 0x44(r1)
	mtlr r0
	addi r1, r1, 0x40
	blr
1:	bl reload
	lwz r0, 0x44(r1)
	mtlr r0
	addi r1, r1, 0x40
voice:
	stwu r1, -0x40(r1)
	jump 0x8010CDD0
reload:
	lwz r3, 0x8(r1)
	lwz r4, 0xc(r1)
	lwz r5, 0x10(r1)
	lwz r6, 0x14(r1)
	lwz r7, 0x18(r1)
	lwz r8, 0x1c(r1)
	lwz r9, 0x20(r1)
	blr

# fn_80097614 (actor r3's release), in place of its first instruction: every record of r3, or with r3 as its opponent,
# gives back what it took first, and their contexts go.
imp_release:
	stwu r1, -0x40(r1)
	mflr r0
	stw r0, 0x44(r1)
	stmw r22, 0x18(r1)
	stw r3, 0x8(r1)
	mr r22, r3
	bl here
	mr r27, r11
	li r28, 0
1:	mulli r0, r28, REC
	add r26, r27, r0
	lwz r30, R_ACTOR(r26)
	cmpwi r30, 0
	beq 3f
	cmpw r30, r22
	beq 2f
	lwz r0, R_OPP(r26)
	cmpw r0, r22
	bne 3f
2:	bl restore_all
3:	addi r28, r28, 1
	cmpwi r28, RECS
	blt 1b
	addi r9, r27, CTX
	li r0, 2
	mtctr r0
4:	lwz r10, C_ACTOR(r9)
	cmpw r10, r22
	beq 5f
	lwz r10, C_OPP(r9)
	cmpw r10, r22
	bne 6f
5:	li r10, 0
	stw r10, C_ACTOR(r9)
6:	addi r9, r9, CTXLEN
	bdnz 4b
	lwz r3, 0x8(r1)
	lmw r22, 0x18(r1)
	lwz r0, 0x44(r1)
	mtlr r0
	addi r1, r1, 0x40
	stwu r1, -0x10(r1)
	jump 0x80097618

# fn_8019C75C (a clip's tracks onto a pose), in place of its li r0, 1 once a track's bone (0x24(r31)) is known: a track on
# the model's own bones (attachment 0x28(r31) 0) of a clip `imp_clip` gave a map takes the mapped bone, or is skipped; then
# a bone past the model's nodes (r30 + 0x10, none for a thrown prop) skips the track.
imp_track:
	lwz r12, 0x10(r30)
	cmpwi r12, 0
	beq 2f
	lwz r0, 0x28(r31)
	cmpwi r0, 0
	bne 3f
	mflr r10
	bl here
	mtlr r10
	lwz r11, CUR(r11)
	cmpwi r11, 0
	beq 3f
	lwz r0, 0x24(r31)
	cmplwi r0, AMAPLEN
	bge 1f
	lbzx r0, r11, r0
	cmplwi r0, 0xff
	beq 1f
	stw r0, 0x24(r31)
3:	lbz r12, 9(r12)
	lwz r0, 0x24(r31)
	cmplw r0, r12
	bge 1f
2:	li r0, 1
	blr
1:	lis r12, 0x8019CE64@ha
	addi r12, r12, 0x8019CE64@l
	mtlr r12
	blr

# fn_8019D128, in place of its lwz r0, 0x14(r31) once a track's bone (0x14(r31)) is known: a track on the model's own
# bones (attachment 0x1c(r31) 0, or one past 0x100, which the game takes as a bone too) of a clip `imp_clip2` gave a map
# takes the mapped bone, or is skipped. The game bounds the bone itself.
imp_track2:
	lwz r0, 0x1c(r31)
	cmpwi r0, 0
	beq 1f
	lwz r12, 0x28(r30)
	lhz r12, 0x158(r12)
	cmpw r0, r12
	beq 3f
1:	mflr r10
	bl here
	mtlr r10
	lwz r11, CUR(r11)
	cmpwi r11, 0
	beq 3f
	lwz r0, 0x14(r31)
	cmplwi r0, AMAPLEN
	bge 2f
	lbzx r0, r11, r0
	cmplwi r0, 0xff
	beq 2f
	stw r0, 0x14(r31)
3:	lwz r0, 0x14(r31)
	blr
2:	lis r12, 0x8019D5A4@ha
	addi r12, r12, 0x8019D5A4@l
	mtlr r12
	blr

# fn_8019CEA0, in place of each of its lwz r0, 0(r9) of a track's bone (r9 the track; the game takes the word as the bone,
# unbounded): r0 = the mapped bone of a clip `imp_clip2` gave a map; a track it drops, or whose bone is past the model's
# nodes, is skipped.
imp_word:
	mflr r10
	bl here
	mtlr r10
	lwz r11, CUR(r11)
	lwz r0, 0(r9)
	cmpwi r11, 0
	beqlr
	cmplwi r0, AMAPLEN
	bge 2f
	lbzx r0, r11, r0
	cmplwi r0, 0xff
	beq 2f
	lwz r12, 0x28(r30)
	lbz r12, 9(r12)
	cmplw r0, r12
	bltlr
2:	lis r12, 0x8019D0F8@ha
	addi r12, r12, 0x8019D0F8@l
	mtlr r12
	blr

# fn_8019C75C's li r0, 0 before its track loop (r30 = the channel, r31 its frame, 0x18(r31) the clip): CUR = the clip map
# of the context whose actor's model this is, when the clip is in the opponent's set outside throws and not in the actor's
# own; else 0. r0 = 0.
imp_clip:
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r26, 0x18(r1)
	lwz r28, 0x10(r30)
	lwz r27, 0x18(r31)
	b 0f

# The same for fn_8019D128 and fn_8019CEA0 (the clips that carry the body's motion: the playing one, the one it blends
# from, and the one blending out; r30 the channel, its clip at +0x1C and model at +0x28), in place of their li r0, 0
# before their track loops.
imp_clip2:
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r26, 0x18(r1)
	lwz r28, 0x28(r30)
	lwz r27, 0x1c(r30)
0:	bl here
	mr r29, r11
	li r0, 0
	stw r0, CUR(r29)
	cmpwi r28, 0
	beq 9f
	addi r26, r29, CTX
1:	lwz r0, C_ACTOR(r26)
	cmpwi r0, 0
	beq 2f
	lwz r0, C_RES(r26)
	cmpw r0, r28
	bne 2f
	lwz r3, C_OPPSET(r26)
	mr r4, r27
	li r5, 1
	bl inset
	cmpwi r3, 0
	beq 2f
	lwz r3, C_OWNSET(r26)
	mr r4, r27
	li r5, 0
	bl inset
	cmpwi r3, 0
	bne 2f
	lwz r0, C_MAP(r26)
	stw r0, CUR(r29)
	b 9f
2:	addi r26, r26, CTXLEN
	addi r0, r29, CTX + 2 * CTXLEN
	cmplw r26, r0
	blt 1b
9:	lmw r26, 0x18(r1)
	lwz r0, 0x34(r1)
	mtlr r0
	addi r1, r1, 0x30
	li r0, 0
	blr

# r3 = 1 when clip r4 is in motion set r3 (outside throw states when r5 is 1), else 0. r29 = data. Uses r0, r5-r12, ctr.
inset:
	cmpwi r3, 0
	beq 8f
	lwz r6, 0x24(r3)
	addi r7, r3, 0x28
1:	cmpwi r6, 0
	beq 8f
	lwz r8, 0x24(r7)
	lwz r9, 0x28(r7)
	cmpwi r8, 0
	beq 4f
	cmpwi r9, 0
	beq 4f
	mtctr r8
2:	lwz r0, 4(r9)
	cmpw r0, r4
	bne 3f
	cmpwi r5, 0
	beq 7f
	lwz r10, 0(r9)
	cmplwi r10, 0x173
	bgt 7f
	srwi r12, r10, 3
	addi r12, r12, THROWBITS
	lbzx r12, r29, r12
	clrlwi r10, r10, 29
	srw r12, r12, r10
	andi. r12, r12, 1
	beq 7f
3:	addi r9, r9, 0x18
	bdnz 2b
4:	addi r7, r7, 0x2c
	addi r6, r6, -1
	b 1b
7:	li r3, 1
	blr
8:	li r3, 0
	blr

# fn_80097CE8 (actor r30 plays state 0x8(r31) from set 0x14(r31), or its own +0x1C0 if 0), in place of its li r0, 0: a throw
# state of an actor impersonating across classes, from its own set, comes from the set it had; and so does a throw state
# it hands its opponent (a throw's victim side) with the opponent's set it took. r0 = 0.
imp_play:
	mflr r8
	lwz r4, 0x8(r31)
	cmplwi r4, 0x173
	bgt 9f
	bl here
	srwi r12, r4, 3
	addi r12, r12, THROWBITS
	lbzx r12, r11, r12
	clrlwi r0, r4, 29
	srw r12, r12, r0
	andi. r12, r12, 1
	beq 9f
	lwz r5, 0x14(r31)
	cmpwi r5, 0
	bne 2f
	mr r3, r30
	bl find
	cmpwi r9, 0
	beq 9f
	lwz r0, R_ON(r9)
	andi. r0, r0, ON_CROSS
	beq 9f
	b 3f
2:	mr r9, r11
	li r6, RECS
1:	lwz r0, R_ACTOR(r9)
	cmpwi r0, 0
	beq 4f
	lwz r0, R_ON(r9)
	andi. r0, r0, ON_CROSS
	beq 4f
	lwz r0, R_OPPSET(r9)
	cmpw r0, r5
	bne 4f
	lwz r0, R_OPP(r9)
	cmpw r0, r30
	beq 3f
4:	addi r9, r9, REC
	addic. r6, r6, -1
	bne 1b
	b 9f
3:	lwz r0, R_SET(r9)
	stw r0, 0x14(r31)
9:	mtlr r8
	li r0, 0
	blr

# fn_80024D78's fn_801A4290 (model r3 drawn at world r4, flags r5, palette source r6 = 0, r7): a model whose actor has
# MODEL on is posed, then the opponent's is drawn in its place.
imp_draw:
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r25, 0x14(r1)
	mr r31, r3
	mr r30, r4
	mr r29, r5
	mr r28, r6
	mr r27, r7
	bl find_model
	cmpwi r9, 0
	beq 1f
	mr r25, r9
	lwz r26, R_OPP(r9)
	lwz r26, 0x1bc(r26)
	cmpwi r26, 0
	beq 1f
	mr r3, r31
	bl pose
	mr r3, r26
	mr r4, r30
	mr r5, r29
	mr r6, r31
	mr r7, r27
	mr r8, r26
	mr r9, r31
	mr r10, r25
	bl disguise
	b 2f
1:	mr r3, r31
	mr r4, r30
	mr r5, r29
	mr r6, r28
	mr r7, r27
	call fn_801A4290
2:	lmw r25, 0x14(r1)
	lwz r0, 0x34(r1)
	mtlr r0
	addi r1, r1, 0x30
	blr

# fn_8001A7BC's fn_801A4290 (shadow r3 at r4, flags r5, palette source r6 = the actor's model, r7): with MODEL on, the
# opponent's shadow is drawn instead, posed like their model.
imp_shadow:
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r25, 0x14(r1)
	mr r31, r3
	mr r30, r4
	mr r29, r5
	mr r28, r6
	mr r27, r7
	mr r3, r6
	bl find_model
	cmpwi r9, 0
	beq 1f
	mr r25, r9
	lwz r9, R_OPP(r9)
	lwz r26, 0x1bc(r9)
	cmpwi r26, 0
	beq 1f
	lwz r9, 0x22c(r9)
	cmpwi r9, 0
	beq 1f
	stw r9, 0x8(r1)
	lwz r0, 4(r31)
	andis. r0, r0, 0x40
	bne 3f
	mr r3, r28
	bl pose
3:	lwz r3, 0x8(r1)
	mr r4, r30
	mr r5, r29
	mr r6, r28
	mr r7, r27
	mr r8, r26
	mr r9, r31
	mr r10, r25
	bl disguise
	b 2f
1:	mr r3, r31
	mr r4, r30
	mr r5, r29
	mr r6, r28
	mr r7, r27
	call fn_801A4290
2:	lmw r25, 0x14(r1)
	lwz r0, 0x34(r1)
	mtlr r0
	addi r1, r1, 0x30
	blr

# Model r3 posed at world r30 as fn_801A4290 would (flags r29), unless frozen. Uses the volatile registers.
pose:
	lwz r0, 4(r3)
	andis. r0, r0, 0x40
	bnelr
	mr r4, r30
	rlwinm r5, r29, 0, 28, 28
	jump fn_801A479C

# fn_801A4290(r3, world r4, flags r5, stand-in, r7), with r3's +0x68 and +0x48 kept and its alpha r9's (+0x48): the
# stand-in has model r8's resource and a palette for it from r6's pose, by record r10's classes. r3 = what it returns.
disguise:
	stwu r1, -0x60(r1)
	mflr r0
	stw r0, 0x64(r1)
	stmw r14, 0x10(r1)
	mr r31, r3
	mr r30, r4
	mr r29, r5
	mr r28, r6
	mr r27, r7
	mr r26, r8
	mr r25, r9
	mr r24, r10
	lwz r23, 0(r26)
	lbz r22, 9(r23)
	slwi r9, r22, 6
	addi r9, r9, PAL + 0xf
	neg r9, r9
	clrrwi r9, r9, 4
	stwux r1, r1, r9
	addi r21, r1, FAKE
	addi r20, r1, PAL
	li r0, 0
	li r9, (SAVE - FAKE) / 4
	mtctr r9
	addi r9, r21, -4
1:	stwu r0, 4(r9)
	bdnz 1b
	stw r23, 0(r21)
	lis r0, 0x40
	stw r0, 4(r21)
	stw r20, 0x64(r21)
	lwz r3, R_ACTOR(r24)
	lwz r3, 0x200(r3)
	cmplwi r3, 2
	ble 1f
	li r3, 0
1:	lwz r4, R_OPP(r24)
	lwz r4, 0x200(r4)
	cmplwi r4, 2
	ble 2f
	li r4, 0
2:	bl here
	addi r9, r11, BASES
	lbzx r19, r9, r4
	mulli r4, r4, 3
	add r4, r4, r3
	mulli r4, r4, MAPLEN
	addi r4, r4, MAPS
	add r18, r11, r4
	lwz r9, 0(r28)
	lbz r17, 9(r9)
	lwz r16, 0x64(r28)
	lwz r15, 0xa8(r28)
	li r14, 0
	lwz r9, 0xb0(r28)
	cmpwi r9, 0
	beq 3f
	lwz r14, 0x88(r9)
# Each node's world matrix (rows 0-2 its axes, row 3 its position), parents first.
3:	li r3, 0
	lwz r4, 0x80(r23)
	mr r5, r20
4:	cmpw r3, r22
	bge 20f
	li r6, -1
	cmpw r3, r19
	bge 5f
	lbzx r6, r18, r3
	cmpw r6, r17
	blt 5f
	li r6, -1
5:	lbz r7, 0x20(r4)
	extsb r7, r7
	cmpwi r6, 0
	blt 6f
	slwi r8, r6, 6
	add r8, r16, r8
	b 8f
6:	cmpwi r7, 0
	blt 7f
	slwi r8, r7, 6
	add r8, r20, r8
	b 8f
7:	mr r8, r16
8:	li r9, 16
	mtctr r9
	addi r9, r8, -4
	addi r10, r5, -4
9:	lwzu r11, 4(r9)
	stwu r11, 4(r10)
	bdnz 9b
	lfs f1, 0(r4)
	lfs f2, 4(r4)
	lfs f3, 8(r4)
	cmpwi r6, 0
	blt 10f
	cmpwi r14, 0
	beq 10f
	slwi r9, r6, 4
	add r9, r14, r9
	lfs f0, 0(r9)
	fadds f1, f1, f0
	lfs f0, 4(r9)
	fadds f2, f2, f0
	lfs f0, 8(r9)
	fadds f3, f3, f0
10:	cmpwi r7, 0
	bge 12f
	li r9, 0
	cmpwi r6, 0
	blt 11f
	mr r9, r6
11:	slwi r9, r9, 4
	add r9, r15, r9
	lfs f4, 0(r9)
	lfs f5, 4(r9)
	lfs f6, 8(r9)
	b 13f
12:	slwi r9, r7, 6
	add r9, r20, r9
	lfs f4, 0x30(r9)
	lfs f5, 0x34(r9)
	lfs f6, 0x38(r9)
	bl axes
13:	stfs f4, 0x30(r5)
	stfs f5, 0x34(r5)
	stfs f6, 0x38(r5)
	addi r3, r3, 1
	addi r4, r4, 0x30
	addi r5, r5, 0x40
	b 4b
# Then each one's inverse bind, a translation by its negated bind position (fn_80440F30).
20:	li r3, 0
	lwz r4, 0x80(r23)
	mr r9, r20
21:	cmpw r3, r22
	bge 22f
	lfs f1, 0x10(r4)
	lfs f2, 0x14(r4)
	lfs f3, 0x18(r4)
	lfs f4, 0x30(r9)
	lfs f5, 0x34(r9)
	lfs f6, 0x38(r9)
	bl axes
	stfs f4, 0x30(r9)
	stfs f5, 0x34(r9)
	stfs f6, 0x38(r9)
	addi r3, r3, 1
	addi r4, r4, 0x30
	addi r9, r9, 0x40
	b 21b
22:	addi r9, r31, 0x68 - 4
	addi r10, r1, SAVE - 4
	li r0, 16
	mtctr r0
23:	lwzu r0, 4(r9)
	stwu r0, 4(r10)
	bdnz 23b
	lwz r0, 0x48(r31)
	stw r0, SAVE + 0x40(r1)
	lwz r0, 0x48(r25)
	stw r0, 0x48(r31)
	li r5, 0
	bl streams
	mr r3, r31
	mr r4, r30
	mr r5, r29
	mr r6, r21
	mr r7, r27
	call fn_801A4290
	mr r19, r3
	li r5, 1
	bl streams
	addi r9, r1, SAVE - 4
	addi r10, r31, 0x68 - 4
	li r0, 16
	mtctr r0
24:	lwzu r0, 4(r9)
	stwu r0, 4(r10)
	bdnz 24b
	lwz r0, SAVE + 0x40(r1)
	stw r0, 0x48(r31)
	mr r3, r19
	lwz r1, 0(r1)
	lmw r14, 0x10(r1)
	lwz r0, 0x64(r1)
	mtlr r0
	addi r1, r1, 0x60
	blr

# The skinner (fn_802244BC) reuses an instance's skinned vertices (+0xFC) within the frame it skinned them (+0x10C).
# r5 = 0 saves those of r31 and its linked instances (+0x10-0x1C) at r1 + STREAMS and clears the frames, so they're
# skinned from the stand-in's palette; r5 = 1 puts them back. Uses r0, r6-r10, ctr.
streams:
	li r6, 0
	addi r7, r1, STREAMS - 4
1:	mr r8, r31
	cmpwi r6, 0
	beq 2f
	slwi r9, r6, 2
	add r9, r31, r9
	lwz r8, 0xc(r9)
2:	cmpwi r8, 0
	bne 3f
	addi r7, r7, 0x20
	b 6f
3:	addi r9, r8, 0xfc - 4
	li r0, 8
	mtctr r0
	cmpwi r5, 0
	bne 5f
4:	lwzu r10, 4(r9)
	stwu r10, 4(r7)
	bdnz 4b
	li r0, -1
	stw r0, 0x10c(r8)
	stw r0, 0x110(r8)
	stw r0, 0x114(r8)
	stw r0, 0x118(r8)
	b 6f
5:	lwzu r10, 4(r7)
	stwu r10, 4(r9)
	bdnz 5b
6:	addi r6, r6, 1
	cmpwi r6, 5
	blt 1b
	blr

# (f4, f5, f6) += f1 * row 0 + f2 * row 1 + f3 * row 2 of the matrix at r9. Uses f0.
axes:
	lfs f0, 0x00(r9)
	fmadds f4, f1, f0, f4
	lfs f0, 0x04(r9)
	fmadds f5, f1, f0, f5
	lfs f0, 0x08(r9)
	fmadds f6, f1, f0, f6
	lfs f0, 0x10(r9)
	fmadds f4, f2, f0, f4
	lfs f0, 0x14(r9)
	fmadds f5, f2, f0, f5
	lfs f0, 0x18(r9)
	fmadds f6, f2, f0, f6
	lfs f0, 0x20(r9)
	fmadds f4, f3, f0, f4
	lfs f0, 0x24(r9)
	fmadds f5, f3, f0, f5
	lfs f0, 0x28(r9)
	fmadds f6, f3, f0, f6
	blr

# r11 = data. Uses r0.
here:
	mflr r0
	bcl 20, 31, 1f
1:	mflr r11
	mtlr r0
	addi r11, r11, data - 1b
	blr

	.balign 4
data:
