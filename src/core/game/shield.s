# The shield throw (`base_moves.shield_throw`), in the Daredevil-base text section after airthrow.s, as game/dol.ts (daredevil) adds it.
# Position-independent like gun.s: game functions are called through ctr and `data` is found from the pc.
#   powerpc-eabi-as -mgekko -mregnames -o shield.o shield.s
#   powerpc-eabi-ld -Ttext=0x80700000 -e sh_spawn \
#     --defsym fn_800503B8=0x800503B8 --defsym fn_800FD5FC=0x800FD5FC --defsym fn_800ACFA8=0x800ACFA8 \
#     --defsym fn_800AE398=0x800AE398 --defsym fn_80393D0C=0x80393D0C --defsym fn_80067050=0x80067050 \
#     --defsym fn_80065CB0=0x80065CB0 --defsym fn_8042EC54=0x8042EC54 --defsym fn_8007E698=0x8007E698 \
#     --defsym Entity_GetActor=0x800CC5E0 --defsym fn_80434900=0x80434900 --defsym fn_804317BC=0x804317BC \
#     --defsym fn_8042FF2C=0x8042FF2C --defsym strcmp=0x80172654 --defsym fn_80097CE8=0x80097CE8 \
#     --defsym fn_8009FD04=0x8009FD04 --defsym fn_800B0C58=0x800B0C58 -o shield.elf shield.o
#   powerpc-eabi-objcopy -O binary -j .text shield.elf shield.bin
# `data`: {u32 clock ms of the last refresh, PLAYERS x slot, u32 count, count x entry}, entries written by dol.ts.
	.text
	.globl sh_spawn, sh_pose, sh_pressed, sh_damage, sh_play, sh_hit
	.set PLAYERS, 4
	.set SLOT, 0x38
	.set S_ACTOR, 0
	.set S_ENTRY, 4
	.set S_ID, 8
	.set S_FLAGS, 12
	.set S_START, 16
	.set S_DIR, 20
	.set S_FROM, 32
	.set S_TICK, 44
	.set S_HIT, 48               # the fighter it last bounced off, and when
	.set S_HIT_MS, 52
	.set F_AWAY, 1
	.set F_BACK, 2
	.set F_DIR, 4
	.set ENTRY, 0xdc
	.set E_NAME, 0
	.set E_ALT, 0x20
	.set E_TPL, 0x40
	.set E_TPL_ALT, 0x60
	.set E_GLINT, 0x80
	.set E_BONE, 0xa0
	.set E_MODE, 0xa1
	.set E_NODES, 0xa2
	.set E_MARKER, 0xa3
	.set E_CHEST, 0xa4
	.set E_RADIUS, 0xa8
	.set E_MIN_MS, 0xac
	.set E_SPEED, 0xb0
	.set E_OUT, 0xb4
	.set E_OUT_MS, 0xb8
	.set E_LIFE_MS, 0xbc
	.set E_BLOCKING, 0xc0
	.set E_HIT, 0xc4
	.set E_BIND, 0xc8
	.set E_THROW, 0xd4
	.set E_BOUNCE, 0xd8
	.set RANGED, 1              # fn_800CC0BC action: attack held
	.set FAR, 0x33              # SuperAttackFar
	.set MARKER_KIND, 0x15
	.set HIT, 0x800             # projectile +0x290 once it has hit
	.set BLOCKING, 0x100        # controller +0x18
	.set HIT_GAP, 250           # ms before the same fighter bounces it again

	.macro call fn
	lis r12, \fn@ha
	addi r12, r12, \fn@l
	mtctr r12
	bctrl
	.endm

	.macro clock reg
	lis \reg, 0x8059
	lwz \reg, 0x3c2c(\reg)
	.endm

# f = the f32 with bits hi:lo, through 8(r1).
	.macro fimm f, hi, lo
	lis r0, \hi
	ori r0, r0, \lo
	stw r0, 8(r1)
	lfs \f, 8(r1)
	.endm

# fn_800F0C70, in place of its bl fn_800503B8 (spawn template r3 with matrix r4 for actor r5): marks the shield away and sends it along the matrix's forward row.
sh_spawn:
	stwu r1, -0x40(r1)
	mflr r0
	stw r0, 0x44(r1)
	stmw r26, 0x28(r1)
	mr r31, r3
	mr r30, r5
	mr r26, r4
	call fn_800503B8
	mr. r29, r3
	beq 9f
	mr r4, r30
	bl slot_of
	mr. r28, r9
	beq 9f
	mr r27, r11
	addi r3, r28, E_TPL
	li r4, 0
	call fn_800FD5FC
	cmpw r3, r31
	beq 1f
	addi r3, r28, E_TPL_ALT
	li r4, 0
	call fn_800FD5FC
	cmpw r3, r31
	bne 9f
1:	lwz r0, 0x24(r29)
	stw r0, S_ID(r27)
	li r0, F_AWAY
	stw r0, S_FLAGS(r27)
	clock r9
	stw r9, S_START(r27)
	lfs f0, 0xa8(r29)
	stfs f0, S_FROM(r27)
	lfs f0, 0xac(r29)
	stfs f0, S_FROM + 4(r27)
	lfs f0, 0xb0(r29)
	stfs f0, S_FROM + 8(r27)
	lfs f1, E_THROW(r28)
	lfs f0, 0x10(r26)
	stfs f0, S_DIR(r27)
	fmuls f0, f0, f1
	stfs f0, 0x10(r1)
	lfs f0, 0x14(r26)
	stfs f0, S_DIR + 4(r27)
	fmuls f0, f0, f1
	stfs f0, 0x14(r1)
	lfs f0, 0x18(r26)
	stfs f0, S_DIR + 8(r27)
	fmuls f0, f0, f1
	stfs f0, 0x18(r1)
	li r0, 0
	stw r0, 0x1c(r1)
	li r0, F_AWAY | F_DIR
	stw r0, S_FLAGS(r27)
	mr r3, r29
	addi r4, r1, 0x10
	call fn_80065CB0
9:	mr r3, r29
	lmw r26, 0x28(r1)
	lwz r0, 0x44(r1)
	mtlr r0
	addi r1, r1, 0x40
	blr

# fn_801A479C, in place of its lwz r0, 0xec(r30) after posing (r30 = the model, 0x8(r31) the actor): follows the shield, and shrinks the prop bone's skin matrix while it is away.
sh_pose:
	stwu r1, -0x40(r1)
	mflr r0
	stw r0, 0x44(r1)
	stmw r24, 0x20(r1)
	mr r24, r30
	lwz r25, 0x8(r31)
	addi r25, r25, -0x78
	bl refresh
	mr r4, r25
	bl slot_of
	mr. r27, r9
	beq 9f
	mr r28, r11
	clock r29
	lwz r0, S_TICK(r28)
	cmpw r0, r29
	beq 5f
	stw r29, S_TICK(r28)
	mr r3, r25
	mr r4, r27
	mr r5, r28
	mr r6, r29
	bl tick
5:	lwz r0, S_FLAGS(r28)
	andi. r0, r0, F_AWAY
	beq 9f
	lwz r9, 0(r24)
	lbz r0, 9(r9)
	lbz r10, E_NODES(r27)
	cmplw r0, r10
	blt 9f
	lwz r9, 0x64(r24)
	lbz r0, E_BONE(r27)
	slwi r0, r0, 6
	add r9, r9, r0
	fimm f1, 0x38d1, 0xb717     # 1e-4
	fimm f7, 0x3f7f, 0xf972     # 1 - 1e-4
	lfs f2, E_BIND(r27)
	lfs f3, E_BIND + 4(r27)
	lfs f4, E_BIND + 8(r27)
	li r10, 0
7:	lfsx f5, r9, r10
	fmuls f5, f5, f2
	addi r11, r10, 0x10
	lfsx f6, r9, r11
	fmadds f5, f6, f3, f5
	addi r11, r10, 0x20
	lfsx f6, r9, r11
	fmadds f5, f6, f4, f5
	addi r11, r10, 0x30
	lfsx f6, r9, r11
	fmadds f6, f5, f7, f6
	stfsx f6, r9, r11
	addi r10, r10, 4
	cmpwi r10, 12
	blt 7b
	li r10, 3
	mtctr r10
6:	lfs f0, 0(r9)
	fmuls f0, f0, f1
	stfs f0, 0(r9)
	lfs f0, 4(r9)
	fmuls f0, f0, f1
	stfs f0, 4(r9)
	lfs f0, 8(r9)
	fmuls f0, f0, f1
	stfs f0, 8(r9)
	addi r9, r9, 0x10
	bdnz 6b
9:	lwz r12, 0x44(r1)
	mtlr r12
	lmw r24, 0x20(r1)
	addi r1, r1, 0x40
	lwz r0, 0xec(r30)
	blr

# Actor r3, entry r4, slot r5, clock r6: puts a gone, expired or caught shield back on the arm with the sparkle, and steers it in mode 1.
tick:
	stwu r1, -0x40(r1)
	mflr r0
	stw r0, 0x44(r1)
	stmw r26, 0x20(r1)
	mr r31, r3
	mr r30, r4
	mr r29, r5
	mr r28, r6
	lwz r0, S_FLAGS(r29)
	andi. r0, r0, F_AWAY
	beq 9f
	lwz r3, S_ID(r29)
	call fn_800ACFA8
	mr. r27, r3
	beq 7f
	lwz r0, 0x2c(r27)
	andis. r0, r0, 0x100
	bne 7f
	lwz r0, S_START(r29)
	subf r26, r0, r28
	lwz r0, E_LIFE_MS(r30)
	cmpw r26, r0
	bge 6f
	lwz r0, E_MIN_MS(r30)
	cmpw r26, r0
	blt 3f
	mr r3, r31
	mr r4, r30
	mr r5, r27
	bl reach
	lfs f0, E_RADIUS(r30)
	fmuls f0, f0, f0
	fcmpo cr0, f1, f0
	cror 2, 0, 2
	beq 6f
3:	lbz r0, E_MODE(r30)
	cmpwi r0, 0
	beq 9f
	mr r3, r31
	mr r4, r30
	mr r5, r29
	mr r6, r27
	mr r7, r26
	bl steer
	b 9f
6:	mr r3, r27
	li r4, 0
	li r5, 0
	call fn_800AE398
7:	li r0, 0
	stw r0, S_ID(r29)
	stw r0, S_FLAGS(r29)
	mr r3, r31
	addi r4, r30, E_GLINT
	li r5, MARKER_KIND
	lbz r6, E_MARKER(r30)
	call fn_80393D0C
9:	lmw r26, 0x20(r1)
	lwz r0, 0x44(r1)
	mtlr r0
	addi r1, r1, 0x40
	blr

# f1 = squared distance from shield r5 to the chest of actor r3 (entry r4), and f2-f4 the way there. Uses f0.
reach:
	lfs f2, 0xa8(r3)
	lfs f0, 0xa8(r5)
	fsubs f2, f2, f0
	lfs f3, 0xac(r3)
	lfs f0, 0xac(r5)
	fsubs f3, f3, f0
	lfs f4, 0xb0(r3)
	lfs f0, E_CHEST(r4)
	fadds f4, f4, f0
	lfs f0, 0xb0(r5)
	fsubs f4, f4, f0
	fmuls f1, f2, f2
	fmadds f1, f3, f3, f1
	fmadds f1, f4, f4, f1
	blr

# Mode 1 for actor r3 (entry r4, slot r5), shield r6, r7 ms out: after a hit, bounce, distance or time out it flies at the chest, harmless.
steer:
	stwu r1, -0x50(r1)
	mflr r0
	stw r0, 0x54(r1)
	stmw r27, 0x3c(r1)
	mr r31, r3
	mr r30, r4
	mr r29, r5
	mr r28, r6
	mr r27, r7
	lwz r0, S_FLAGS(r29)
	andi. r9, r0, F_BACK
	bne 5f
	andi. r9, r0, F_DIR
	bne 2f
	mr r3, r28
	addi r4, r1, 0x10
	call fn_80067050
	cmpwi r3, 0
	beq 2f
	bl long_enough
	beq 2f
	addi r3, r1, 0x10
	call fn_8042EC54
	lfs f0, 0x10(r1)
	stfs f0, S_DIR(r29)
	lfs f0, 0x14(r1)
	stfs f0, S_DIR + 4(r29)
	lfs f0, 0x18(r1)
	stfs f0, S_DIR + 8(r29)
	lwz r0, S_FLAGS(r29)
	ori r0, r0, F_DIR
	stw r0, S_FLAGS(r29)
2:	lwz r0, 0x290(r28)
	andi. r0, r0, HIT
	bne 4f
	lwz r0, E_OUT_MS(r30)
	cmpw r27, r0
	bge 4f
	lfs f1, 0xa8(r28)
	lfs f0, S_FROM(r29)
	fsubs f1, f1, f0
	lfs f2, 0xac(r28)
	lfs f0, S_FROM + 4(r29)
	fsubs f2, f2, f0
	lfs f3, 0xb0(r28)
	lfs f0, S_FROM + 8(r29)
	fsubs f3, f3, f0
	fmuls f1, f1, f1
	fmadds f1, f2, f2, f1
	fmadds f1, f3, f3, f1
	lfs f0, E_OUT(r30)
	fmuls f0, f0, f0
	fcmpo cr0, f1, f0
	bge 4f
	lwz r0, S_FLAGS(r29)
	andi. r0, r0, F_DIR
	beq 9f
	mr r3, r28
	addi r4, r1, 0x10
	call fn_80067050
	cmpwi r3, 0
	beq 9f
	lfs f1, 0x10(r1)
	lfs f0, S_DIR(r29)
	fmuls f1, f1, f0
	lfs f2, 0x14(r1)
	lfs f0, S_DIR + 4(r29)
	fmadds f1, f2, f0, f1
	lfs f2, 0x18(r1)
	lfs f0, S_DIR + 8(r29)
	fmadds f1, f2, f0, f1
	fimm f0, 0, 0
	fcmpo cr0, f1, f0
	bge 9f
4:	lwz r0, S_FLAGS(r29)
	ori r0, r0, F_BACK
	stw r0, S_FLAGS(r29)
	li r0, 0
	stw r0, 0x298(r28)
5:	mr r3, r31
	mr r4, r30
	mr r5, r28
	bl reach
	stfs f2, 0x10(r1)
	stfs f3, 0x14(r1)
	stfs f4, 0x18(r1)
	li r0, 0
	stw r0, 0x1c(r1)
	bl long_enough
	beq 9f
	addi r3, r1, 0x10
	call fn_8042EC54
	lfs f1, E_SPEED(r30)
	lfs f0, 0x10(r1)
	fmuls f0, f0, f1
	stfs f0, 0x10(r1)
	lfs f0, 0x14(r1)
	fmuls f0, f0, f1
	stfs f0, 0x14(r1)
	lfs f0, 0x18(r1)
	fmuls f0, f0, f1
	stfs f0, 0x18(r1)
	mr r3, r28
	addi r4, r1, 0x10
	call fn_80065CB0
9:	lmw r27, 0x3c(r1)
	lwz r0, 0x54(r1)
	mtlr r0
	addi r1, r1, 0x50
	blr

# cr0 ne when the vector at 0x10(r1) of the caller's frame (r1) is longer than 1 mm. Uses r0, f0-f2, 8(r1).
long_enough:
	lfs f1, 0x10(r1)
	fmuls f1, f1, f1
	lfs f2, 0x14(r1)
	fmadds f1, f2, f2, f1
	lfs f2, 0x18(r1)
	fmadds f1, f2, f2, f1
	fimm f0, 0x3586, 0x37bd     # 1e-6
	fcmpo cr0, f1, f0
	li r0, 0
	ble 1f
	li r0, 1
1:	cmpwi r0, 0
	blr

# fn_800CC0BC (was action r30 pressed on controller r29), in place of its mr r0, r3 after the answer r3: the ranged attack isn't pressed while the shield is away.
sh_pressed:
	cmpwi r30, RANGED
	bne 8f
	cmpwi r3, 0
	beq 8f
	stwu r1, -0x20(r1)
	mflr r0
	stw r0, 0x24(r1)
	stw r3, 0x10(r1)
	mr r3, r29
	call Entity_GetActor
	mr. r4, r3
	beq 7f
	bl slot_of
	cmpwi r9, 0
	beq 7f
	lwz r0, S_FLAGS(r11)
	andi. r0, r0, F_AWAY
	beq 7f
	li r0, 0
	stw r0, 0x10(r1)
7:	lwz r3, 0x10(r1)
	lwz r0, 0x24(r1)
	mtlr r0
	addi r1, r1, 0x20
8:	mr r0, r3
	blr

# fn_8002FD50 (damage f1 to actor r28), in place of its bl fn_8007E698: scales the damage by the entry's share (blocking's while blocking) while the shield is on the arm.
sh_damage:
	stwu r1, -0x20(r1)
	mflr r0
	stw r0, 0x24(r1)
	call fn_8007E698
	stfs f1, 0x10(r1)
	mr r4, r28
	bl slot_of
	cmpwi r9, 0
	beq 9f
	lwz r0, S_FLAGS(r11)
	andi. r0, r0, F_AWAY
	bne 9f
	lwz r3, 0x3dc(r28)
	cmpwi r3, 0
	beq 9f
	lwz r0, 0x18(r3)
	andi. r0, r0, BLOCKING
	lfs f0, E_HIT(r9)
	beq 1f
	lfs f0, E_BLOCKING(r9)
1:	lfs f1, 0x10(r1)
	fmuls f1, f1, f0
	stfs f1, 0x10(r1)
9:	lfs f1, 0x10(r1)
	lwz r0, 0x24(r1)
	mtlr r0
	addi r1, r1, 0x20
	blr

# fn_800DDCB4, in place of its bl fn_80097CE8 (play motion r4 on actor r3, r5, f1, r6, f2, f3): the far super attack returns -1 while the shield is away.
sh_play:
	cmpwi r4, FAR
	bne 8f
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r28, 0x10(r1)
	mr r31, r3
	mr r30, r5
	mr r29, r6
	stfs f1, 0x20(r1)
	stfs f2, 0x24(r1)
	stfs f3, 0x28(r1)
	mr r4, r3
	bl slot_of
	li r3, -1
	cmpwi r9, 0
	beq 1f
	lwz r0, S_FLAGS(r11)
	andi. r0, r0, F_AWAY
	bne 9f
1:	mr r3, r31
	li r4, FAR
	mr r5, r30
	mr r6, r29
	lfs f1, 0x20(r1)
	lfs f2, 0x24(r1)
	lfs f3, 0x28(r1)
	call fn_80097CE8
9:	lmw r28, 0x10(r1)
	lwz r0, 0x34(r1)
	mtlr r0
	addi r1, r1, 0x30
	blr
8:	lis r12, fn_80097CE8@ha
	addi r12, r12, fn_80097CE8@l
	mtctr r12
	bctr

# fn_8009FF54 (projectile r3 has hit r4), in place of its bl fn_8009FD04: in mode 0 the shield bounces off a fighter, whose body it passes through.
sh_hit:
	stwu r1, -0x40(r1)
	mflr r0
	stw r0, 0x44(r1)
	stmw r28, 0x30(r1)
	mr r31, r3
	mr r30, r4
	call fn_8009FD04
	mr r3, r30
	call fn_800B0C58
	cmpwi r3, 0
	beq 9f
	lwz r4, 0x24(r31)
	bl shot_of
	mr. r29, r9
	beq 9f
	mr r28, r11
	lbz r0, E_MODE(r29)
	cmpwi r0, 0
	bne 9f
	clock r9
	lwz r0, S_HIT(r28)
	cmpw r0, r30
	bne 1f
	lwz r0, S_HIT_MS(r28)
	subf r0, r0, r9
	cmpwi r0, HIT_GAP
	blt 9f
1:	stw r30, S_HIT(r28)
	stw r9, S_HIT_MS(r28)
	mr r3, r31
	addi r4, r1, 0x20
	call fn_80067050
	cmpwi r3, 0
	beq 9f
	lfs f0, 0xa8(r31)
	lfs f1, 0xa8(r30)
	fsubs f0, f0, f1
	stfs f0, 0x10(r1)
	lfs f0, 0xac(r31)
	lfs f1, 0xac(r30)
	fsubs f0, f0, f1
	stfs f0, 0x14(r1)
	li r0, 0
	stw r0, 0x18(r1)
	stw r0, 0x1c(r1)
	bl long_enough
	beq 3f
	addi r3, r1, 0x10
	call fn_8042EC54
	bl along
	fimm f0, 0, 0
	fcmpo cr0, f1, f0
	blt 4f
# already past the fighter's middle: straight back
3:	lfs f0, 0x20(r1)
	fneg f0, f0
	stfs f0, 0x10(r1)
	lfs f0, 0x24(r1)
	fneg f0, f0
	stfs f0, 0x14(r1)
	li r0, 0
	stw r0, 0x18(r1)
	bl long_enough
	beq 9f
	addi r3, r1, 0x10
	call fn_8042EC54
	bl along
4:	fadds f1, f1, f1
	lfs f3, E_BOUNCE(r29)
	lfs f0, 0x20(r1)
	lfs f2, 0x10(r1)
	fnmsubs f0, f1, f2, f0
	fmuls f0, f0, f3
	stfs f0, 0x20(r1)
	lfs f0, 0x24(r1)
	lfs f2, 0x14(r1)
	fnmsubs f0, f1, f2, f0
	fmuls f0, f0, f3
	stfs f0, 0x24(r1)
	lfs f0, 0x28(r1)
	fmuls f0, f0, f3
	stfs f0, 0x28(r1)
	li r0, 0
	stw r0, 0x2c(r1)
	mr r3, r31
	addi r4, r1, 0x20
	call fn_80065CB0
9:	lmw r28, 0x30(r1)
	lwz r0, 0x44(r1)
	mtlr r0
	addi r1, r1, 0x40
	blr

# f1 = the caller's velocity at 0x20(r1) along its flat normal at 0x10(r1). Uses f0, f2.
along:
	lfs f1, 0x20(r1)
	lfs f0, 0x10(r1)
	fmuls f1, f1, f0
	lfs f2, 0x24(r1)
	lfs f0, 0x14(r1)
	fmadds f1, f2, f0, f1
	blr

# r9 = the entry whose away shield has id r4, or 0; r11 its slot. Uses r0, r10, ctr.
shot_of:
	mflr r10
	bl here
	mtlr r10
	addi r11, r11, 4
	li r0, PLAYERS
	mtctr r0
1:	lwz r9, S_ID(r11)
	cmpwi r9, 0
	beq 2f
	cmpw r9, r4
	bne 2f
	lwz r9, S_FLAGS(r11)
	andi. r9, r9, F_AWAY
	beq 2f
	lwz r9, S_ENTRY(r11)
	blr
2:	addi r11, r11, SLOT
	bdnz 1b
	li r9, 0
	blr

# r9 = actor r4's entry or 0, r11 its slot. Uses r0, r10, ctr.
slot_of:
	mflr r10
	bl here
	mtlr r10
	addi r11, r11, 4
	li r0, PLAYERS
	mtctr r0
1:	lwz r9, S_ACTOR(r11)
	cmpw r9, r4
	bne 2f
	lwz r9, S_ENTRY(r11)
	blr
2:	addi r11, r11, SLOT
	bdnz 1b
	li r9, 0
	blr

# Each player's actor and entry, once a frame. A slot whose actor changes forgets its shield.
refresh:
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r25, 0x14(r1)
	bl here
	mr r31, r11
	clock r9
	lwz r10, 0(r31)
	cmpw r9, r10
	beq 9f
	stw r9, 0(r31)
	li r30, 0
2:	cmpwi r30, PLAYERS
	bge 9f
	mulli r28, r30, SLOT
	add r28, r28, r31
	addi r28, r28, 4
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
	addi r4, r26, E_NAME
	call strcmp
	cmpwi r3, 0
	beq 5f
	addi r3, r29, 4
	addi r4, r26, E_ALT
	call strcmp
	cmpwi r3, 0
	beq 5f
	addi r26, r26, ENTRY
	addi r27, r27, -1
	b 3b
4:	li r26, 0
5:	lwz r0, S_ACTOR(r28)
	cmpw r0, r25
	beq 6f
	li r0, 0
	stw r0, S_ID(r28)
	stw r0, S_FLAGS(r28)
	stw r0, S_TICK(r28)
6:	stw r25, S_ACTOR(r28)
	stw r26, S_ENTRY(r28)
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
