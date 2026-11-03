# Damage stages (`model.damage_stages`), in a text section of its own after the game's, as game/dol.ts (health) adds it.
# Position-independent like gun.s: game functions are called through ctr and `data` is found from the pc.
#   powerpc-eabi-as -mgekko -mregnames -o health.o health.s
#   powerpc-eabi-ld -Ttext=0x80700000 -e h_pose \
#     --defsym fn_80434900=0x80434900 --defsym fn_804317BC=0x804317BC --defsym fn_8042FF2C=0x8042FF2C \
#     --defsym strcmp=0x80172654 --defsym stealth_test=0x801377CC -o health.elf health.o
#   powerpc-eabi-objcopy -O binary -j .text health.elf health.bin
# `data`: {u32 clock ms of the last refresh, PLAYERS x {actor, model instance, entry or 0, block shown or -1}, u32 count,
# count x entry}, written by dol.ts.
# An entry: {f32 health fractions[3] (falling; -1 unused), u8 block of the untouched copies, u8 block of the Z twins
# (0xff without), u8 blocks (a costume's parts are blocks x n), pad, char[32] entity name, char[32] alt entity name}.
# Block kept + 1 + i is stage i's textures; build/patch.ts lays the parts out.
	.text
	.globl h_pose
	.set PLAYERS, 4
	.set SLOT, 16
	.set SLOTS, 4
	.set COUNT, SLOTS + SLOT * PLAYERS
	.set ENTRIES, COUNT + 4
	.set ENTRY, 0x50
	.set KEPT, 0xc
	.set ZBLOCK, 0xd
	.set BLOCKS, 0xe
	.set NAMES, 0x10
	.set Z_STAGED, 512          # zactions.s flag: a Z costume that this file draws

	.macro call fn
	lis r12, \fn@ha
	addi r12, r12, \fn@l
	mtctr r12
	bctrl
	.endm

# fn_801A479C, in place of its mr r3, r30 (r30 = the model being posed), once per drawn model per frame: once a frame,
# each player's actor gets the textures of its health's stage (or of Z while Z holds them). A slot whose actor, model or
# entry changes shows nothing yet, so a new round or model is set again.
h_pose:
	stwu r1, -0x40(r1)
	mflr r0
	stw r0, 0x44(r1)
	stmw r23, 0x1c(r1)
	bl here
	mr r31, r11
	lis r9, 0x8059
	lwz r0, 0x3c2c(r9)
	lwz r9, 0(r31)
	cmpw r0, r9
	beq 9f
	stw r0, 0(r31)
	li r30, 0
2:	cmpwi r30, PLAYERS
	bge 9f
	slwi r28, r30, 4
	add r28, r28, r31
	addi r28, r28, SLOTS
	li r25, 0
	li r26, 0
	li r27, 0
	lis r3, 0x8055
	addi r3, r3, 0x2110
	call fn_80434900
	cmpw r30, r3
	bge 5f
	lis r3, 0x8055
	addi r3, r3, 0x2110
	mr r4, r30
	call fn_804317BC
	mr r29, r3
	call fn_8042FF2C
	mr. r25, r3
	beq 5f
	lwz r27, 0x1bc(r25)
	lwz r24, COUNT(r31)
	addi r26, r31, ENTRIES
3:	cmpwi r24, 0
	ble 4f
	addi r3, r29, 4
	addi r4, r26, NAMES
	call strcmp
	cmpwi r3, 0
	beq 5f
	addi r3, r29, 4
	addi r4, r26, NAMES + 0x20
	call strcmp
	cmpwi r3, 0
	beq 5f
	addi r26, r26, ENTRY
	addi r24, r24, -1
	b 3b
4:	li r26, 0
5:	lwz r0, 0(r28)
	cmpw r0, r25
	bne 6f
	lwz r0, 4(r28)
	cmpw r0, r27
	bne 6f
	lwz r0, 8(r28)
	cmpw r0, r26
	beq 7f
6:	stw r25, 0(r28)
	stw r27, 4(r28)
	stw r26, 8(r28)
	li r0, -1
	stw r0, 12(r28)
7:	cmpwi r26, 0
	beq 8f
	cmpwi r27, 0
	beq 8f
	mr r3, r25
	mr r4, r26
	bl block_of
	lwz r0, 12(r28)
	cmpw r0, r3
	beq 8f
	stw r3, 12(r28)
	mr r4, r3
	mr r3, r27
	lbz r5, BLOCKS(r26)
	bl swap
8:	addi r30, r30, 1
	b 2b
9:	lmw r23, 0x1c(r1)
	lwz r0, 0x44(r1)
	mtlr r0
	addi r1, r1, 0x40
	mr r3, r30
	blr

# r3 = the block actor r3 (entry r4) shows: Z's while Z holds it, else the deepest stage whose fraction its health is at
# or below, else the untouched copies.
block_of:
	stwu r1, -0x20(r1)
	mflr r0
	stw r0, 0x24(r1)
	stw r31, 0x1c(r1)
	stw r30, 0x18(r1)
	mr r31, r3
	mr r30, r4
	lbz r0, ZBLOCK(r30)
	cmpwi r0, 0xff
	beq 1f
	mr r4, r31
	li r5, Z_STAGED
	call stealth_test
	cmpwi r0, 0
	beq 1f
	lbz r3, ZBLOCK(r30)
	b 9f
1:	lbz r3, KEPT(r30)
	lfs f1, 0x31c(r31)
	lfs f2, 0x320(r31)
	fsubs f0, f2, f2
	fcmpu cr0, f2, f0
	ble 9f
	fdivs f1, f1, f2
	li r9, 0
	mr r10, r30
2:	lfs f3, 0(r10)
	fcmpu cr0, f1, f3
	bgt 3f
	lbz r3, KEPT(r30)
	add r3, r3, r9
	addi r3, r3, 1
3:	addi r9, r9, 1
	addi r10, r10, 4
	cmpwi r9, 3
	blt 2b
9:	lwz r30, 0x18(r1)
	lwz r31, 0x1c(r1)
	lwz r0, 0x24(r1)
	mtlr r0
	addi r1, r1, 0x20
	blr

# Model instance r3's parts are r5 blocks of n. Each material its meshes draw (part j, or a part of the same name) takes
# texture 0 of part j + r4 * n.
swap:
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r22, 0x8(r1)
	mr r22, r4
	lwz r9, 0(r3)
	lwz r29, 0xac(r3)
	lbz r28, 4(r9)
	lbz r27, 8(r9)
	lwz r26, 0x88(r9)
	cmpwi r5, 0
	beq 9f
	cmpw r22, r5
	bge 9f
	divwu r0, r27, r5
	mullw r10, r0, r5
	cmpw r10, r27
	bne 9f
	mr. r27, r0
	beq 9f
	mullw r22, r22, r27
1:	cmpwi r28, 0
	beq 9f
	lwz r25, 0(r29)
	cmpwi r25, 0
	beq 4f
	li r24, 0
2:	cmpw r24, r27
	bge 4f
	slwi r0, r24, 2
	lwzx r23, r26, r0
	cmpw r23, r25
	beq 3f
	addi r3, r25, 0x28
	addi r4, r23, 0x28
	call strcmp
	cmpwi r3, 0
	beq 3f
	addi r24, r24, 1
	b 2b
3:	add r0, r24, r22
	slwi r0, r0, 2
	lwzx r9, r26, r0
	lwz r0, 0x14(r9)
	stw r0, 0x14(r25)
4:	addi r29, r29, 4
	addi r28, r28, -1
	b 1b
9:	lmw r22, 0x8(r1)
	lwz r0, 0x34(r1)
	mtlr r0
	addi r1, r1, 0x30
	blr

# r11 = `data`. Uses r0.
here:
	mflr r0
	bcl 20, 31, 1f
1:	mflr r11
	mtlr r0
	addi r11, r11, data - 1b
	blr

	.balign 4
data:
