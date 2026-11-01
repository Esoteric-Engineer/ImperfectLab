# The gun (`z_button.gun`), in a text section of its own after the game's, as game/dol.ts (gun) adds it. Position-independent:
# game functions are called through ctr and `data` is found from the pc, so the section can load anywhere.
#   powerpc-eabi-as -mgekko -mregnames -o gun.o gun.s
#   powerpc-eabi-ld -Ttext=0x80700000 -e gun_pose \
#     --defsym fn_8019D5E0=0x8019D5E0 --defsym fn_80434900=0x80434900 --defsym fn_804317BC=0x804317BC \
#     --defsym fn_8042FF2C=0x8042FF2C --defsym strcmp=0x80172654 --defsym stealth_test=0x801377C0 \
#     --defsym fn_80084B68=0x80084B68 --defsym fn_80084A60=0x80084A60 --defsym fn_800CC5E0=0x800CC5E0 \
#     --defsym fn_800CC148=0x800CC148 -o gun.elf gun.o
#   powerpc-eabi-objcopy -O binary -j .text gun.elf gun.bin
# `data`: {u32 clock ms of the last refresh, PLAYERS x {actor, entry or 0, the attack its shot plays for}, u32 count,
# count x entry}, written by dol.ts.
# An entry: {u8 gun bone, hand, thigh, nodes a model needs, u8 flags (1 machine gun), 3 pad, f32 energy per shot,
# f32 gun bone's bind position[3], f32 holster K[4][3] (the gun's skin matrix is K times the thigh's), char[32] entity name,
# char[32] alt entity name}.
	.text
	.globl gun_pose, gun_play, gun_pressed, gun_pick, gun_motion
	.set GROUND, 0x14e          # action1
	.set AIR, 0x14f             # action2
	.set MAGIC, 86              # event 0x4E value 87: tuning field 176
	.set PLAYERS, 4
	.set SLOT, 12
	.set ENTRY, 0x88
	.set NAMES, 0x48

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

# fn_801A479C, in place of its bl fn_8019D5E0 (r30 = the model, r31 its frame, 0x8(r31) the actor's world matrix at +0x78):
# poses the bones, then puts the gun's skin matrix (model+0x64) on the hand while Z holds it, else in the holster.
gun_pose:
	stwu r1, -0x40(r1)
	mflr r0
	stw r0, 0x44(r1)
	stmw r25, 0x24(r1)
	lwz r29, 0x8(r31)
	mr r28, r30
	call fn_8019D5E0
	bl refresh
	addi r4, r29, -0x78
	mr r29, r4
	bl gun_of
	mr. r27, r9
	beq 9f
	lwz r9, 0(r28)
	lbz r0, 9(r9)
	lbz r10, 3(r27)
	cmplw r0, r10
	blt 9f
	lwz r26, 0x64(r28)
	lbz r0, 0(r27)
	slwi r0, r0, 6
	add r25, r26, r0
	mr r4, r29
	li r5, 128
	call stealth_test
	cmpwi r0, 0
	beq 2f
	lbz r9, 1(r27)
	slwi r9, r9, 6
	add r9, r26, r9
	addi r9, r9, -4
	addi r10, r25, -4
	li r0, 16
	mtctr r0
1:	lwzu r0, 4(r9)
	stwu r0, 4(r10)
	bdnz 1b
	b 5f
2:	lbz r9, 2(r27)
	slwi r9, r9, 6
	add r9, r26, r9
	addi r10, r27, 0x18
	mr r11, r25
	li r0, 4
	mtctr r0
3:	lfs f1, 0(r10)
	lfs f2, 4(r10)
	lfs f3, 8(r10)
	lfs f0, 0(r9)
	fmuls f4, f1, f0
	lfs f0, 0x10(r9)
	fmadds f4, f2, f0, f4
	lfs f0, 0x20(r9)
	fmadds f4, f3, f0, f4
	lfs f0, 4(r9)
	fmuls f5, f1, f0
	lfs f0, 0x14(r9)
	fmadds f5, f2, f0, f5
	lfs f0, 0x24(r9)
	fmadds f5, f3, f0, f5
	lfs f0, 8(r9)
	fmuls f6, f1, f0
	lfs f0, 0x18(r9)
	fmadds f6, f2, f0, f6
	lfs f0, 0x28(r9)
	fmadds f6, f3, f0, f6
	bdz 4f
	stfs f4, 0(r11)
	stfs f5, 4(r11)
	stfs f6, 8(r11)
	addi r10, r10, 12
	addi r11, r11, 0x10
	b 3b
4:	lfs f0, 0x30(r9)
	fadds f4, f4, f0
	lfs f0, 0x34(r9)
	fadds f5, f5, f0
	lfs f0, 0x38(r9)
	fadds f6, f6, f0
	stfs f4, 0(r11)
	stfs f5, 4(r11)
	stfs f6, 8(r11)
5:	lwz r9, 0xa8(r28)
	lbz r0, 0(r27)
	slwi r0, r0, 4
	add r9, r9, r0
	lfs f1, 0xc(r27)
	lfs f2, 0x10(r27)
	lfs f3, 0x14(r27)
	li r10, 0
6:	lfsx f0, r25, r10
	fmuls f4, f1, f0
	addi r11, r10, 0x10
	lfsx f0, r25, r11
	fmadds f4, f2, f0, f4
	addi r11, r10, 0x20
	lfsx f0, r25, r11
	fmadds f4, f3, f0, f4
	addi r11, r10, 0x30
	lfsx f0, r25, r11
	fadds f4, f4, f0
	stfsx f4, r9, r10
	addi r10, r10, 4
	cmpwi r10, 12
	blt 6b
9:	lmw r25, 0x24(r1)
	lwz r0, 0x44(r1)
	mtlr r0
	addi r1, r1, 0x40
	blr

# fn_80097CE8 (play motion r4 on actor r3), in place of its first instruction: while Z holds the gun, an attack or ranged
# attack plays the shot instead and takes its energy, or nothing plays when the bar is short of it.
gun_play:
	cmplwi r4, 0x60
	blt 1f
	cmplwi r4, 0x63
	ble 2f
	b 8f
1:	cmplwi r4, 0x27
	blt 8f
	cmplwi r4, 0x40
	bgt 8f
	cmplwi r4, 0x3a
	beq 8f
	cmplwi r4, 0x3d
	beq 8f
2:	stwu r1, -0x40(r1)
	mflr r0
	stw r0, 0x44(r1)
	stmw r29, 0x34(r1)
	stw r3, 0x8(r1)
	stw r4, 0xc(r1)
	stw r5, 0x10(r1)
	stw r6, 0x14(r1)
	stfs f1, 0x18(r1)
	stfs f2, 0x1c(r1)
	stfs f3, 0x20(r1)
	bl refresh
	lwz r4, 0x8(r1)
	bl gun_of
	mr. r31, r9
	beq 5f
	lwz r4, 0x8(r1)
	li r5, 128
	call stealth_test
	cmpwi r0, 0
	beq 5f
	li r30, GROUND
	lwz r0, 0xc(r1)
	cmplwi r0, 0x36
	ble 3f
	cmplwi r0, 0x60
	beq 3f
	cmplwi r0, 0x61
	beq 3f
	li r30, AIR
3:	lwz r3, 0x8(r1)
	lfs f1, 8(r31)
	call fn_80084B68
	cmpwi r3, 0
	li r3, -1
	beq 6f
	lwz r3, 0x8(r1)
	lfs f1, 8(r31)
	call fn_80084A60
	lwz r4, 0x8(r1)
	bl gun_of
	lwz r0, 0xc(r1)
	stw r0, 8(r11)
	stw r30, 0xc(r1)
5:	lwz r3, 0x8(r1)
	lwz r4, 0xc(r1)
	lwz r5, 0x10(r1)
	lwz r6, 0x14(r1)
	lfs f1, 0x18(r1)
	lfs f2, 0x1c(r1)
	lfs f3, 0x20(r1)
	lmw r29, 0x34(r1)
	lwz r0, 0x44(r1)
	mtlr r0
	addi r1, r1, 0x40
8:	stwu r1, -0x48(r1)
	jump 0x80097CEC
6:	lmw r29, 0x34(r1)
	lwz r0, 0x44(r1)
	mtlr r0
	addi r1, r1, 0x40
	blr

# fn_800CC0BC (was action r4 pressed on controller r3), in place of its first instruction: while Z holds the gun, the ranged
# attack (1, attack held) never is, attack (2) isn't during a shot, and with the machine gun is while attack is held.
gun_pressed:
	cmplwi r4, 1
	blt 8f
	cmplwi r4, 2
	bgt 8f
	stwu r1, -0x20(r1)
	mflr r0
	stw r0, 0x24(r1)
	stmw r28, 0x10(r1)
	mr r31, r3
	mr r28, r4
	bl refresh
	mr r3, r31
	call fn_800CC5E0
	mr r30, r3
	mr r4, r3
	bl gun_of
	mr. r29, r9
	beq 2f
	mr r4, r30
	li r5, 128
	call stealth_test
	cmpwi r0, 0
	beq 2f
	cmpwi r28, 1
	beq 1f
	mr r3, r30
	bl motion_raw
	cmpwi r3, GROUND
	beq 1f
	cmpwi r3, AIR
	beq 1f
	lbz r0, 4(r29)
	andi. r0, r0, 1
	beq 2f
	mr r3, r31
	li r4, 1
	call fn_800CC148
	cmpwi r3, 0
	beq 2f
	li r3, 1
	b 3f
1:	li r3, 0
3:	lmw r28, 0x10(r1)
	lwz r0, 0x24(r1)
	mtlr r0
	addi r1, r1, 0x20
	blr
2:	mr r3, r31
	mr r4, r28
	lmw r28, 0x10(r1)
	lwz r0, 0x24(r1)
	mtlr r0
	addi r1, r1, 0x20
8:	stwu r1, -0x20(r1)
	jump 0x800CC0C0

# fn_800E1788's event 0x4E (r4 = value) for controller r3, as r3 = the projectile pick (+0x409): value - 1 clamped to 0-3 as
# the game does, except MAGIC, whose bullets cost nothing more (+0x414): gun_play took the shot's energy.
gun_pick:
	addi r0, r4, -1
	cmpwi r0, MAGIC
	beq 1f
	li r3, 0
	cmpwi r0, 0
	bltlr
	li r3, 3
	cmpwi r0, 3
	bgtlr
	mr r3, r0
	blr
1:	li r0, 0
	stw r0, 0x414(r3)
	li r3, MAGIC
	blr

# fn_8009B04C (actor r3's motion), in place of its first instruction: a shot answers as the attack it plays for, so the
# melee state treats it as that attack, in the air as on the ground.
gun_motion:
	stwu r1, -0x10(r1)
	mflr r0
	stw r0, 0x14(r1)
	stw r31, 0xc(r1)
	mr r31, r3
	bl motion_raw
	cmpwi r3, GROUND
	beq 1f
	cmpwi r3, AIR
	bne 2f
1:	mr r4, r31
	bl gun_of
	cmpwi r9, 0
	beq 2f
	lwz r0, 8(r11)
	cmpwi r0, 0
	beq 2f
	mr r3, r0
2:	lwz r31, 0xc(r1)
	lwz r0, 0x14(r1)
	mtlr r0
	addi r1, r1, 0x10
	blr

# fn_8009B04C itself.
motion_raw:
	stwu r1, -0x10(r1)
	jump 0x8009B050

# r9 = actor r4's gun entry, or 0, and r11 its slot. Uses r0, r10, ctr.
gun_of:
	mflr r10
	bl here
	mtlr r10
	addi r11, r11, 4
	li r0, PLAYERS
	mtctr r0
1:	lwz r9, 0(r11)
	cmpw r9, r4
	bne 2f
	lwz r9, 4(r11)
	blr
2:	addi r11, r11, SLOT
	bdnz 1b
	li r9, 0
	blr

# Each player's actor and gun entry, once a frame. A slot whose actor changes forgets its attack.
refresh:
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r25, 0x14(r1)
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
	mulli r28, r30, SLOT
	add r28, r28, r31
	li r25, 0
	li r26, 0
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
	mr r25, r3
	lwz r27, 4 + SLOT * PLAYERS(r31)
	addi r26, r31, 8 + SLOT * PLAYERS
3:	cmpwi r27, 0
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
	addi r27, r27, -1
	b 3b
4:	li r26, 0
5:	lwz r0, 4(r28)
	cmpw r0, r25
	beq 6f
	li r0, 0
	stw r0, 12(r28)
6:	stw r25, 4(r28)
	stw r26, 8(r28)
	addi r30, r30, 1
	b 2b
9:	lmw r25, 0x14(r1)
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
