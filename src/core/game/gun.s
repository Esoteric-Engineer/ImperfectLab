# The gun (`z_button.gun`), in a text section of its own after the game's, as game/dol.ts (gun) adds it. Position-independent:
# game functions are called through ctr and `data` is found from the pc, so the section can load anywhere.
#   powerpc-eabi-as -mgekko -mregnames -o gun.o gun.s
#   powerpc-eabi-ld -Ttext=0x80700000 -e gun_pose \
#     --defsym fn_8019D5E0=0x8019D5E0 --defsym fn_80434900=0x80434900 --defsym fn_804317BC=0x804317BC \
#     --defsym fn_8042FF2C=0x8042FF2C --defsym strcmp=0x80172654 --defsym stealth_test=0x801377C0 \
#     --defsym fn_80084B68=0x80084B68 --defsym fn_80084A60=0x80084A60 --defsym fn_800CC5E0=0x800CC5E0 \
#     --defsym fn_800CC148=0x800CC148 -o gun.elf gun.o
#   powerpc-eabi-objcopy -O binary -j .text gun.elf gun.bin
# `data`: {u32 clock ms of the last refresh, PLAYERS x {actor, entry or 0, the attack its shot plays for, f32 draw progress,
# u32 clock ms it was last posed}, u32 count, count x entry}, written by dol.ts.
# An entry: {u8 gun bone, hand, thigh, nodes a model needs, u8 flags (1 machine gun), u8 upper arm, forearm, pad,
# f32 energy per shot, f32 gun bone's bind position[3], f32 holster K[4][3] (the gun's skin matrix is K times the thigh's),
# f32 bind positions[3] of the upper arm, forearm and hand, f32 draw progress per ms, u8 bone masks[16] of the upper arm,
# forearm and hand with what hangs from them (the gun bone left out), char[32] entity name, char[32] alt entity name}.
	.text
	.globl gun_pose, gun_play, gun_pressed, gun_pick, gun_motion
	.set GROUND, 0x14e          # action1
	.set AIR, 0x14f             # action2
	.set MAGIC, 86              # event 0x4E value 87: tuning field 176
	.set PLAYERS, 4
	.set SLOT, 20
	.set ENTRY, 0xe0
	.set NAMES, 0xa0
	.set C_ZERO, 0
	.set C_HALF, 0xc
	.set C_ONE, 0x10
	.set C_THREEHALF, 0x14
	.set C_TWO, 0x18
	.set C_THREE, 0x1c
	.set C_EPS, 0x20
	.set C_TINY, 0x24
	.set C_MAGIC, 0x28

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

# d = 1 / sqrt(x), x > 0, with r31 = consts. Uses f11-f13.
	.macro rsq d, x
	frsqrte \d, \x
	lfs f12, C_HALF(r31)
	lfs f13, C_THREEHALF(r31)
	.rept 3
	fmuls f11, \d, \d
	fmuls f11, f11, \x
	fnmsubs f11, f11, f12, f13
	fmuls \d, \d, f11
	.endr
	.endm

# fn_801A479C, in place of its bl fn_8019D5E0 (r30 = the model, r31 its frame, 0x8(r31) the actor's world matrix at +0x78):
# poses the bones, then draws or holsters the gun: its progress runs from 0 (holstered) to 1 (in hand) over the entry's
# draw time while Z holds it, and back. The arm reaches for the holster up to halfway, where the gun moves to the hand.
gun_pose:
	stwu r1, -0x50(r1)
	mflr r0
	stw r0, 0x54(r1)
	stmw r22, 0x20(r1)
	stfd f31, 0x48(r1)
	lwz r29, 0x8(r31)
	mr r28, r30
	call fn_8019D5E0
	bl refresh
	addi r4, r29, -0x78
	mr r29, r4
	bl gun_of
	mr. r27, r9
	beq 9f
	mr r24, r11
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
	mr r23, r0
	bl here
	addi r31, r11, consts - data
	lis r9, 0x8059
	lwz r3, 0x3c2c(r9)
	lwz r0, 16(r24)
	stw r3, 16(r24)
	subf r3, r0, r3
	cmplwi r3, 100
	ble 1f
	li r3, 100
1:	lis r0, 0x4330
	stw r0, 0x18(r1)
	stw r3, 0x1c(r1)
	lfd f1, 0x18(r1)
	lfd f0, C_MAGIC(r31)
	fsub f1, f1, f0
	frsp f1, f1
	lfs f0, 0x6c(r27)
	fmuls f1, f1, f0
	lfs f2, 12(r24)
	cmpwi r23, 0
	beq 2f
	fadds f2, f2, f1
	lfs f0, C_ONE(r31)
	fcmpo cr0, f2, f0
	ble 3f
	fmr f2, f0
	b 3f
2:	fsubs f2, f2, f1
	lfs f0, C_ZERO(r31)
	fcmpo cr0, f2, f0
	bge 3f
	fmr f2, f0
3:	stfs f2, 12(r24)
	fadds f6, f2, f2
	li r23, 0
	lfs f0, C_HALF(r31)
	fcmpo cr0, f2, f0
	blt 4f
	li r23, 1
	lfs f0, C_TWO(r31)
	fsubs f6, f0, f6
4:	fadds f7, f6, f6
	lfs f0, C_THREE(r31)
	fsubs f7, f0, f7
	fmuls f8, f6, f6
	fmuls f31, f8, f7
	lbz r9, 2(r27)
	slwi r9, r9, 6
	add r9, r26, r9
	addi r10, r27, 0x18
	mr r11, r25
	li r0, 4
	mtctr r0
5:	lfs f1, 0(r10)
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
	bdz 6f
	stfs f4, 0(r11)
	stfs f5, 4(r11)
	stfs f6, 8(r11)
	addi r10, r10, 12
	addi r11, r11, 0x10
	b 5b
6:	lfs f0, 0x30(r9)
	fadds f4, f4, f0
	lfs f0, 0x34(r9)
	fadds f5, f5, f0
	lfs f0, 0x38(r9)
	fadds f6, f6, f0
	stfs f4, 0(r11)
	stfs f5, 4(r11)
	stfs f6, 8(r11)
	lfs f0, C_ZERO(r31)
	fcmpo cr0, f31, f0
	ble 7f
	mr r3, r28
	mr r4, r27
	mr r5, r25
	bl reach
7:	cmpwi r23, 0
	beq 8f
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
8:	lwz r9, 0xa8(r28)
	lbz r0, 0(r27)
	slwi r0, r0, 4
	add r9, r9, r0
	lfs f1, 0xc(r27)
	lfs f2, 0x10(r27)
	lfs f3, 0x14(r27)
	li r10, 0
1:	lfsx f0, r25, r10
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
	blt 1b
9:	lfd f31, 0x48(r1)
	lmw r22, 0x20(r1)
	lwz r0, 0x54(r1)
	mtlr r0
	addi r1, r1, 0x50
	blr

# fn_80097CE8 (play motion r4 on actor r3), in place of its first instruction: while Z holds the gun, an attack or ranged
# attack other than a rise attack plays the shot instead and takes its energy, or nothing plays while the gun is still
# being drawn or when the bar is short of the energy.
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
	cmplwi r4, 0x2e
	beq 8f
	cmplwi r4, 0x36
	beq 8f
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
	lwz r4, 0x8(r1)
	bl gun_of
	lfs f0, 12(r11)
	lis r0, 0x3f80
	stw r0, 0x24(r1)
	lfs f1, 0x24(r1)
	fcmpu cr0, f0, f1
	li r3, -1
	bne 6f
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

# Each player's actor and gun entry, once a frame. A slot whose actor changes forgets its attack and draw.
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
	stw r0, 16(r28)
6:	stw r25, 4(r28)
	stw r26, 8(r28)
	addi r30, r30, 1
	b 2b
9:	lmw r25, 0x14(r1)
	lwz r0, 0x34(r1)
	mtlr r0
	addi r1, r1, 0x30
	blr

# The arm's reach for the holster at weight f31 (r31 = consts), on model r3 with entry r4, the holstered gun's skin matrix at r5.
# Each moved bone's skin matrix and position (model+0xa8) turn about the joint.
reach:
	stwu r1, -0x180(r1)
	mflr r0
	stw r0, 0x184(r1)
	stmw r23, 0x150(r1)
	lwz r29, 0x64(r3)
	lwz r28, 0xa8(r3)
	mr r30, r4
	mr r27, r5
	lbz r26, 3(r30)
	addi r3, r1, 0x10
	addi r4, r30, 0x48
	lbz r5, 5(r30)
	slwi r5, r5, 6
	add r5, r29, r5
	bl xf
	addi r3, r1, 0x20
	addi r4, r30, 0x54
	lbz r5, 6(r30)
	slwi r5, r5, 6
	add r5, r29, r5
	bl xf
	addi r3, r1, 0x30
	addi r4, r30, 0x60
	lbz r5, 1(r30)
	slwi r5, r5, 6
	add r5, r29, r5
	bl xf
	addi r3, r1, 0x40
	addi r4, r30, 0x60
	mr r5, r27
	bl xf
	addi r3, r1, 0x40
	addi r4, r1, 0x40
	addi r5, r1, 0x30
	bl vsub
	addi r3, r1, 0x40
	addi r4, r1, 0x30
	addi r5, r1, 0x40
	fmr f1, f31
	bl vmad
	addi r3, r1, 0x50
	addi r4, r1, 0x20
	addi r5, r1, 0x10
	bl vsub
	addi r4, r1, 0x50
	bl vlen
	stfs f1, 0x108(r1)
	addi r3, r1, 0x60
	addi r4, r1, 0x30
	addi r5, r1, 0x20
	bl vsub
	addi r4, r1, 0x60
	bl vlen
	stfs f1, 0x10c(r1)
	addi r3, r1, 0x60
	addi r4, r1, 0x40
	addi r5, r1, 0x10
	bl vsub
	addi r3, r1, 0x70
	addi r4, r1, 0x60
	bl vunit
	lfs f0, C_EPS(r31)
	fcmpo cr0, f1, f0
	ble 7f
	lfs f2, 0x108(r1)
	lfs f3, 0x10c(r1)
	fsubs f4, f2, f3
	fabs f4, f4
	fadds f4, f4, f0
	fadds f5, f2, f3
	fsubs f5, f5, f0
	fcmpo cr0, f1, f4
	bge 1f
	fmr f1, f4
1:	fcmpo cr0, f1, f5
	ble 2f
	fmr f1, f5
2:	stfs f1, 0x110(r1)
	addi r4, r1, 0x50
	addi r5, r1, 0x70
	bl vdot
	fneg f1, f1
	addi r3, r1, 0x80
	addi r4, r1, 0x50
	addi r5, r1, 0x70
	bl vmad
	addi r3, r1, 0x80
	addi r4, r1, 0x80
	bl vunit
	lfs f0, C_EPS(r31)
	fcmpo cr0, f1, f0
	ble 7f
	lfs f2, 0x108(r1)
	lfs f3, 0x10c(r1)
	lfs f4, 0x110(r1)
	fmuls f5, f2, f2
	fmadds f5, f4, f4, f5
	fnmsubs f5, f3, f3, f5
	fmuls f6, f2, f4
	fadds f6, f6, f6
	fdivs f5, f5, f6
	lfs f7, C_ONE(r31)
	fcmpo cr0, f5, f7
	ble 3f
	fmr f5, f7
3:	fneg f8, f7
	fcmpo cr0, f5, f8
	bge 4f
	fmr f5, f8
4:	stfs f5, 0x114(r1)
	fnmsubs f6, f5, f5, f7
	lfs f1, C_ZERO(r31)
	lfs f0, C_TINY(r31)
	fcmpo cr0, f6, f0
	ble 5f
	rsq f9, f6
	fmuls f1, f6, f9
5:	fmuls f1, f1, f2
	stfs f1, 0x118(r1)
	lfs f1, 0x114(r1)
	fmuls f1, f1, f2
	addi r3, r1, 0x90
	addi r4, r1, 0x10
	addi r5, r1, 0x70
	bl vmad
	lfs f1, 0x118(r1)
	addi r3, r1, 0x90
	addi r4, r1, 0x90
	addi r5, r1, 0x80
	bl vmad
	lfs f1, 0x110(r1)
	addi r3, r1, 0xa0
	addi r4, r1, 0x10
	addi r5, r1, 0x70
	bl vmad
	addi r3, r1, 0xb0
	addi r4, r1, 0x50
	bl vunit
	addi r3, r1, 0xc0
	addi r4, r1, 0x90
	addi r5, r1, 0x10
	bl vsub
	addi r3, r1, 0xc0
	addi r4, r1, 0xc0
	bl vunit
	addi r3, r1, 0xd0
	addi r4, r1, 0xb0
	addi r5, r1, 0xc0
	bl qrot
	addi r3, r1, 0xe0
	addi r4, r1, 0xd0
	bl qmat
	mr r3, r29
	addi r4, r30, 0x70
	addi r5, r1, 0xe0
	addi r6, r1, 0x10
	mr r7, r26
	mr r8, r28
	bl apply
	addi r3, r1, 0x30
	addi r4, r1, 0x30
	addi r5, r1, 0xe0
	addi r6, r1, 0x10
	bl rotp
	addi r3, r1, 0xb0
	addi r4, r1, 0x30
	addi r5, r1, 0x90
	bl vsub
	addi r3, r1, 0xb0
	addi r4, r1, 0xb0
	bl vunit
	addi r3, r1, 0xc0
	addi r4, r1, 0xa0
	addi r5, r1, 0x90
	bl vsub
	addi r3, r1, 0xc0
	addi r4, r1, 0xc0
	bl vunit
	addi r3, r1, 0xd0
	addi r4, r1, 0xb0
	addi r5, r1, 0xc0
	bl qrot
	addi r3, r1, 0xe0
	addi r4, r1, 0xd0
	bl qmat
	mr r3, r29
	addi r4, r30, 0x80
	addi r5, r1, 0xe0
	addi r6, r1, 0x90
	mr r7, r26
	mr r8, r28
	bl apply
7:	lbz r9, 1(r30)
	slwi r9, r9, 6
	add r23, r29, r9
	li r6, 0
1:	li r7, 0
2:	lfsx f1, r23, r6
	lfsx f2, r27, r7
	fmuls f3, f1, f2
	addi r8, r6, 0x10
	lfsx f1, r23, r8
	addi r9, r7, 0x10
	lfsx f2, r27, r9
	fmadds f3, f1, f2, f3
	addi r8, r6, 0x20
	lfsx f1, r23, r8
	addi r9, r7, 0x20
	lfsx f2, r27, r9
	fmadds f3, f1, f2, f3
	mulli r10, r6, 3
	add r10, r10, r7
	addi r10, r10, 0x120
	stfsx f3, r1, r10
	addi r7, r7, 4
	cmpwi r7, 12
	blt 2b
	addi r6, r6, 4
	cmpwi r6, 12
	blt 1b
	addi r3, r1, 0xd0
	addi r4, r1, 0x120
	bl mquat
	lfs f1, 0(r3)
	lfs f2, 4(r3)
	lfs f3, 8(r3)
	lfs f4, 12(r3)
	lfs f0, C_ONE(r31)
	fsubs f5, f0, f31
	fmadds f1, f1, f31, f5
	fmuls f2, f2, f31
	fmuls f3, f3, f31
	fmuls f4, f4, f31
	stfs f1, 0(r3)
	stfs f2, 4(r3)
	stfs f3, 8(r3)
	stfs f4, 12(r3)
	bl qnorm
	addi r3, r1, 0xe0
	addi r4, r1, 0xd0
	bl qmat
	addi r3, r1, 0x30
	addi r4, r30, 0x60
	mr r5, r23
	bl xf
	mr r3, r29
	addi r4, r30, 0x90
	addi r5, r1, 0xe0
	addi r6, r1, 0x30
	mr r7, r26
	mr r8, r28
	bl apply
	lmw r23, 0x150(r1)
	lwz r0, 0x184(r1)
	mtlr r0
	addi r1, r1, 0x180
	blr

# Turns each bone below r7 with its bit set in mask r4 (byte b / 8, bit b % 8) about point r6 by R r5: skin matrices at r3,
# positions at r8.
apply:
	stwu r1, -0x40(r1)
	mflr r0
	stw r0, 0x44(r1)
	stmw r22, 0x10(r1)
	mr r24, r3
	mr r25, r4
	mr r26, r5
	mr r27, r6
	mr r28, r7
	mr r29, r8
	li r30, 0
1:	cmpw r30, r28
	bge 9f
	srwi r9, r30, 3
	lbzx r9, r25, r9
	clrlwi r10, r30, 29
	srw r9, r9, r10
	andi. r9, r9, 1
	beq 8f
	slwi r9, r30, 6
	add r23, r24, r9
	li r22, 0
2:	add r3, r23, r22
	mr r4, r3
	mr r5, r26
	addi r6, r31, C_ZERO
	bl rotp
	addi r22, r22, 0x10
	cmpwi r22, 0x30
	blt 2b
	addi r3, r23, 0x30
	mr r4, r3
	mr r5, r26
	mr r6, r27
	bl rotp
	slwi r9, r30, 4
	add r3, r29, r9
	mr r4, r3
	mr r5, r26
	mr r6, r27
	bl rotp
8:	addi r30, r30, 1
	b 1b
9:	lmw r22, 0x10(r1)
	lwz r0, 0x44(r1)
	mtlr r0
	addi r1, r1, 0x40
	blr

# Leaf helpers for reach. Vectors are three f32s, quaternions {w, x, y, z}, R three rows of three f32s (row vectors:
# p' = p R). r31 = consts. They use r0, r6-r10 and f0-f13.

# r3 = r4 times skin matrix r5 (rows of 0x10), with its translation.
xf:
	lfs f1, 0(r4)
	lfs f2, 4(r4)
	lfs f3, 8(r4)
	li r6, 0
1:	addi r7, r6, 0x30
	lfsx f0, r5, r7
	lfsx f4, r5, r6
	fmadds f4, f1, f4, f0
	addi r7, r6, 0x10
	lfsx f0, r5, r7
	fmadds f4, f2, f0, f4
	addi r7, r6, 0x20
	lfsx f0, r5, r7
	fmadds f4, f3, f0, f4
	stfsx f4, r3, r6
	addi r6, r6, 4
	cmpwi r6, 12
	blt 1b
	blr

# r3 = r4 - r5
vsub:
	li r6, 0
1:	lfsx f0, r4, r6
	lfsx f2, r5, r6
	fsubs f0, f0, f2
	stfsx f0, r3, r6
	addi r6, r6, 4
	cmpwi r6, 12
	blt 1b
	blr

# r3 = r4 + f1 r5
vmad:
	li r6, 0
1:	lfsx f0, r5, r6
	lfsx f2, r4, r6
	fmadds f0, f1, f0, f2
	stfsx f0, r3, r6
	addi r6, r6, 4
	cmpwi r6, 12
	blt 1b
	blr

# f1 = r4 . r5
vdot:
	lfs f1, 0(r4)
	lfs f0, 0(r5)
	fmuls f1, f1, f0
	lfs f2, 4(r4)
	lfs f0, 4(r5)
	fmadds f1, f2, f0, f1
	lfs f2, 8(r4)
	lfs f0, 8(r5)
	fmadds f1, f2, f0, f1
	blr

# f1 = |r4|
vlen:
	mr r5, r4
	mflr r10
	bl vdot
	mtlr r10
	lfs f0, C_TINY(r31)
	fcmpo cr0, f1, f0
	bgt 1f
	lfs f1, C_ZERO(r31)
	blr
1:	rsq f2, f1
	fmuls f1, f1, f2
	blr

# r3 = r4 / |r4|, f1 = |r4|; with f1 = 0, r3 is left alone.
vunit:
	mr r5, r4
	mflr r10
	bl vdot
	mtlr r10
	lfs f0, C_TINY(r31)
	fcmpo cr0, f1, f0
	bgt 1f
	lfs f1, C_ZERO(r31)
	blr
1:	rsq f2, f1
	fmuls f1, f1, f2
	li r6, 0
2:	lfsx f0, r4, r6
	fmuls f0, f0, f2
	stfsx f0, r3, r6
	addi r6, r6, 4
	cmpwi r6, 12
	blt 2b
	blr

# r3 = (r4 - r6) R r5 + r6; r3 may be r4.
rotp:
	lfs f10, 0(r6)
	lfs f11, 4(r6)
	lfs f12, 8(r6)
	lfs f1, 0(r4)
	fsubs f1, f1, f10
	lfs f2, 4(r4)
	fsubs f2, f2, f11
	lfs f3, 8(r4)
	fsubs f3, f3, f12
	lfs f0, 0(r5)
	fmadds f4, f1, f0, f10
	lfs f0, 12(r5)
	fmadds f4, f2, f0, f4
	lfs f0, 24(r5)
	fmadds f4, f3, f0, f4
	lfs f0, 4(r5)
	fmadds f5, f1, f0, f11
	lfs f0, 16(r5)
	fmadds f5, f2, f0, f5
	lfs f0, 28(r5)
	fmadds f5, f3, f0, f5
	lfs f0, 8(r5)
	fmadds f6, f1, f0, f12
	lfs f0, 20(r5)
	fmadds f6, f2, f0, f6
	lfs f0, 32(r5)
	fmadds f6, f3, f0, f6
	stfs f4, 0(r3)
	stfs f5, 4(r3)
	stfs f6, 8(r3)
	blr

# R r3 of quaternion r4.
qmat:
	lfs f1, 0(r4)
	lfs f2, 4(r4)
	lfs f3, 8(r4)
	lfs f4, 12(r4)
	fadds f5, f2, f2
	fadds f6, f3, f3
	fadds f7, f4, f4
	fmuls f8, f2, f5
	fmuls f9, f3, f6
	fmuls f10, f4, f7
	lfs f0, C_ONE(r31)
	fadds f11, f9, f10
	fsubs f11, f0, f11
	stfs f11, 0(r3)
	fadds f11, f8, f10
	fsubs f11, f0, f11
	stfs f11, 16(r3)
	fadds f11, f8, f9
	fsubs f11, f0, f11
	stfs f11, 32(r3)
	fmuls f8, f2, f6
	fmuls f9, f1, f7
	fadds f11, f8, f9
	stfs f11, 4(r3)
	fsubs f11, f8, f9
	stfs f11, 12(r3)
	fmuls f8, f2, f7
	fmuls f9, f1, f6
	fsubs f11, f8, f9
	stfs f11, 8(r3)
	fadds f11, f8, f9
	stfs f11, 24(r3)
	fmuls f8, f3, f7
	fmuls f9, f1, f5
	fadds f11, f8, f9
	stfs f11, 20(r3)
	fsubs f11, f8, f9
	stfs f11, 28(r3)
	blr

# Quaternion r3 of R r4.
mquat:
	lfs f1, 0(r4)
	lfs f2, 16(r4)
	lfs f3, 32(r4)
	lfs f0, C_ONE(r31)
	fadds f4, f0, f1
	fadds f4, f4, f2
	fadds f4, f4, f3
	fadds f5, f0, f1
	fsubs f5, f5, f2
	fsubs f5, f5, f3
	fsubs f6, f0, f1
	fadds f6, f6, f2
	fsubs f6, f6, f3
	fsubs f7, f0, f1
	fsubs f7, f7, f2
	fadds f7, f7, f3
	lfs f1, 20(r4)
	lfs f2, 28(r4)
	fsubs f8, f1, f2
	fadds f9, f1, f2
	lfs f1, 24(r4)
	lfs f2, 8(r4)
	fsubs f10, f1, f2
	fadds f11, f1, f2
	lfs f1, 4(r4)
	lfs f2, 12(r4)
	fsubs f12, f1, f2
	fadds f13, f1, f2
	li r6, 0
	fmr f1, f4
	fcmpo cr0, f5, f1
	ble 1f
	li r6, 1
	fmr f1, f5
1:	fcmpo cr0, f6, f1
	ble 2f
	li r6, 2
	fmr f1, f6
2:	fcmpo cr0, f7, f1
	ble 3f
	li r6, 3
3:	cmpwi r6, 0
	bne 4f
	stfs f4, 0(r3)
	stfs f8, 4(r3)
	stfs f10, 8(r3)
	stfs f12, 12(r3)
	b 7f
4:	cmpwi r6, 1
	bne 5f
	stfs f8, 0(r3)
	stfs f5, 4(r3)
	stfs f13, 8(r3)
	stfs f11, 12(r3)
	b 7f
5:	cmpwi r6, 2
	bne 6f
	stfs f10, 0(r3)
	stfs f13, 4(r3)
	stfs f6, 8(r3)
	stfs f9, 12(r3)
	b 7f
6:	stfs f12, 0(r3)
	stfs f11, 4(r3)
	stfs f9, 8(r3)
	stfs f7, 12(r3)
7:	lfs f1, 0(r3)
	lfs f0, C_ZERO(r31)
	fcmpo cr0, f1, f0
	bge qnorm
	li r6, 0
8:	lfsx f1, r3, r6
	fneg f1, f1
	stfsx f1, r3, r6
	addi r6, r6, 4
	cmpwi r6, 16
	blt 8b
	b qnorm

# Quaternion r3 turning unit vector r4 onto unit vector r5, then normalized as qnorm.
qrot:
	lfs f1, 0(r4)
	lfs f2, 4(r4)
	lfs f3, 8(r4)
	lfs f4, 0(r5)
	lfs f5, 4(r5)
	lfs f6, 8(r5)
	lfs f0, C_ONE(r31)
	fmadds f7, f1, f4, f0
	fmadds f7, f2, f5, f7
	fmadds f7, f3, f6, f7
	stfs f7, 0(r3)
	fmuls f0, f2, f6
	fnmsubs f0, f3, f5, f0
	stfs f0, 4(r3)
	fmuls f0, f3, f4
	fnmsubs f0, f1, f6, f0
	stfs f0, 8(r3)
	fmuls f0, f1, f5
	fnmsubs f0, f2, f4, f0
	stfs f0, 12(r3)

# Quaternion r3 made unit, or no turn when it's near zero.
qnorm:
	lfs f1, 0(r3)
	lfs f2, 4(r3)
	lfs f3, 8(r3)
	lfs f4, 12(r3)
	fmuls f5, f1, f1
	fmadds f5, f2, f2, f5
	fmadds f5, f3, f3, f5
	fmadds f5, f4, f4, f5
	lfs f0, C_TINY(r31)
	fcmpo cr0, f5, f0
	bgt 1f
	lfs f1, C_ONE(r31)
	lfs f2, C_ZERO(r31)
	stfs f1, 0(r3)
	stfs f2, 4(r3)
	stfs f2, 8(r3)
	stfs f2, 12(r3)
	blr
1:	rsq f6, f5
	fmuls f1, f1, f6
	fmuls f2, f2, f6
	fmuls f3, f3, f6
	fmuls f4, f4, f6
	stfs f1, 0(r3)
	stfs f2, 4(r3)
	stfs f3, 8(r3)
	stfs f4, 12(r3)
	blr

# r11 = `data`. Uses r0.
here:
	mflr r0
	bcl 20, 31, 1f
1:	mflr r11
	mtlr r0
	addi r11, r11, data - 1b
	blr

	.balign 8
consts:
	.float 0, 0, 0
	.float 0.5, 1, 1.5, 2, 3
	.float 0.0001, 1e-12
	.4byte 0x43300000, 0

	.balign 4
data:
