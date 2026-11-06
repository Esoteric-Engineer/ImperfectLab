# The laser beam (`z_button.laser`), in a text section of its own after the game's, as game/dol.ts (laser) adds it.
# Position-independent like gun.s: game functions are called through ctr and `data` is found from the pc.
#   powerpc-eabi-as -mgekko -mregnames -o laser.o laser.s
#   powerpc-eabi-ld -Ttext=0x80700000 -e laser_tick \
#     --defsym fn_80393A60=0x80393A60 --defsym fn_80393D0C=0x80393D0C --defsym fn_8005A9B8=0x8005A9B8 \
#     --defsym fn_8009AD80=0x8009AD80 --defsym fn_800B1668=0x800B1668 --defsym fn_801A5104=0x801A5104 \
#     --defsym fn_800B24AC=0x800B24AC --defsym fn_8004A758=0x8004A758 --defsym fn_80434E0C=0x80434E0C \
#     --defsym fn_80048A74=0x80048A74 --defsym fn_800A2F94=0x800A2F94 --defsym fn_8002FD50=0x8002FD50 \
#     --defsym fn_80434900=0x80434900 --defsym fn_804317BC=0x804317BC --defsym fn_8042FF2C=0x8042FF2C \
#     --defsym fn_800B13D8=0x800B13D8 --defsym fn_80041588=0x80041588 \
#     --defsym stealth_test=0x801377CC --defsym strcmp=0x80172654 --defsym __9Placement=0x80434DB4 -o laser.elf laser.o
#   powerpc-eabi-objcopy -O binary -j .text laser.elf laser.bin
# While Z holds a laser character's live slot (zactions.s, flag 1024) and it stands, its beam effect plays from its
# attachment 67/0, level along its facing; the stick turns it in place. Every frame a ray from there finds what the beam
# hits, every dyngeom of the beam's effect (a length whose fraction is 1/8) is drawn level and no longer than that, and
# every tick what the ray hits and every other player the beam passes through take the entry's damage.
# `data`: {u32 clock ms of the last refresh, PLAYERS x slot, u32 count, count x entry}, written by dol.ts.
# A slot: {actor, entry or 0, u32 state (ON: the effect plays; ALT: costume 2), f32 the beam's length, f32 time toward
# the next tick, f32 direction[3], f32 origin[3], pad to SLOT}.
# An entry: {f32 range, f32 damage per tick, f32 tick (s), f32 beam radius, f32 turn rate (rad/s), u32 damage type,
# u32 damage flags, u32 the hit reaction (a motion, as event 0x1A sets a punch's), char[32] entity name, char[32] alt entity name, char[32] effect, char[32] alt effect}.
	.text
	.globl laser_tick, laser_move, laser_length
	.set PLAYERS, 4
	.set SLOT, 0x40
	.set S_ACTOR, 0
	.set S_ENTRY, 4
	.set S_STATE, 8
	.set S_DIST, 0xc
	.set S_ACC, 0x10
	.set S_DIR, 0x14
	.set S_ORIGIN, 0x20
	.set COUNT, 4 + SLOT * PLAYERS
	.set ENTRIES, COUNT + 4
	.set ENTRY, 0xa0
	.set E_RANGE, 0
	.set E_DAMAGE, 4
	.set E_TICK, 8
	.set E_RADIUS, 0xc
	.set E_TURN, 0x10
	.set E_TYPE, 0x14
	.set E_FLAGS, 0x18
	.set E_REACT, 0x1c
	.set E_NAME, 0x20
	.set E_ALTNAME, 0x40
	.set E_EFFECT, 0x60
	.set E_ALTEFFECT, 0x80
	.set ON, 1
	.set ALT, 2
	.set FLAG, 1024             # zTable's laser bit
	.set KIND, 67               # build/laser.ts's attachment kind, index 0
	.set STAND, 2               # controller states (+0x8) Stand and Run
	.set RUN, 4
	.set C_ZERO, 0
	.set C_HALF, 4
	.set C_THREEHALF, 8
	.set C_ONE, 0xc
	.set C_TINY, 0x10
	.set C_STICK, 0x14
	.set C_BLOCK, 0x18
	.set C_UP, 0x1c
	.set C_MAXSTEP, 0x20
	.set C_EIGHTH, 0x24
	.set C_TOL, 0x28
	.set C_NEAR, 0x2c
	.set C_MAGIC, 0x30

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

# d = 1 / sqrt(x), x > 0, with r28 = consts. Uses f11-f13.
	.macro rsq d, x
	frsqrte \d, \x
	lfs f12, C_HALF(r28)
	lfs f13, C_THREEHALF(r28)
	.rept 3
	fmuls f11, \d, \d
	fmuls f11, f11, \x
	fnmsubs f11, f11, f12, f13
	fmuls \d, \d, f11
	.endr
	.endm

# fn_80074954 (an entity's logic, once a frame), in place of its first instruction: runs it, then the laser of entity r3.
laser_tick:
	stwu r1, -0x20(r1)
	mflr r0
	stw r0, 0x24(r1)
	stw r31, 0x1c(r1)
	stw r30, 0x18(r1)
	mr r31, r3
	bl tick_raw
	mr r30, r3
	mr r3, r31
	bl update
	mr r3, r30
	lwz r30, 0x18(r1)
	lwz r31, 0x1c(r1)
	lwz r0, 0x24(r1)
	mtlr r0
	addi r1, r1, 0x20
	blr

# fn_80074954 itself.
tick_raw:
	stwu r1, -0x30(r1)
	jump 0x80074958

# fn_800CC1D4 (controller r3's stick r4: its strength, and its direction at r5), in place of its first instruction: a
# laser character standing, walking or running while Z holds its slot gets no strength, so it stops and stays.
laser_move:
	stwu r1, -0x20(r1)
	mflr r0
	stw r0, 0x24(r1)
	stw r31, 0x1c(r1)
	stw r30, 0x18(r1)
	mr r31, r3
	mr r30, r4
	bl move_raw
	stfs f1, 0x8(r1)
	cmpwi r30, 0
	bne 1f
	lwz r4, 0xe4(r31)
	bl slot_of
	cmpwi r9, 0
	beq 1f
	lwz r4, 0xe4(r31)
	li r5, FLAG
	call stealth_test
	cmpwi r0, 0
	beq 1f
	lbz r0, 8(r31)
	cmplwi r0, STAND
	blt 1f
	cmplwi r0, RUN
	bgt 1f
	bl here
	lfs f1, consts - data + C_ZERO(r11)
	b 2f
1:	lfs f1, 0x8(r1)
2:	lwz r30, 0x18(r1)
	lwz r31, 0x1c(r1)
	lwz r0, 0x24(r1)
	mtlr r0
	addi r1, r1, 0x20
	blr

# fn_800CC1D4 itself.
move_raw:
	stwu r1, -0x28(r1)
	jump 0x800CC1D8

# The dyngeom effect class's length (its vtable 0x8050F168 + 0xC0, in place of fn_803F85C8) for instance r3: a dyngeom
# of a laser (a length1 whose fraction is 1/8) near a playing beam's origin is turned level along the beam and drawn no
# longer than it. fn_803F7D0C sets the instance's place (+0x20) and direction (+0x130, copied to its matrix +0xE4) from
# its attachment before it asks (or turns it at its target, fn_803F7AC8), and its end from both after.
laser_length:
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r29, 0x24(r1)
	stfd f31, 0x18(r1)
	mr r31, r3
	call 0x803F85C8
	fmr f31, f1
	bl here
	addi r30, r11, consts - data
	addi r29, r11, 4
	lfs f1, 0x19c(r31)
	lfs f0, C_ONE(r30)
	fcmpo cr0, f1, f0
	blt 9f
	fctiwz f2, f1
	stfd f2, 0x8(r1)
	lwz r0, 0xc(r1)
	lis r9, 0x4330
	stw r9, 0x10(r1)
	stw r0, 0x14(r1)
	lfd f3, 0x10(r1)
	lfd f4, C_MAGIC(r30)
	fsub f3, f3, f4
	frsp f3, f3
	fsubs f1, f1, f3
	lfs f0, C_EIGHTH(r30)
	fsubs f1, f1, f0
	fabs f1, f1
	lfs f0, C_TOL(r30)
	fcmpo cr0, f1, f0
	bge 9f
	li r0, PLAYERS
	mtctr r0
1:	lwz r0, S_STATE(r29)
	andi. r0, r0, ON
	beq 2f
	lfs f1, 0x20(r31)
	lfs f0, S_ORIGIN(r29)
	fsubs f1, f1, f0
	fmuls f2, f1, f1
	lfs f1, 0x24(r31)
	lfs f0, S_ORIGIN + 4(r29)
	fsubs f1, f1, f0
	fmadds f2, f1, f1, f2
	lfs f1, 0x28(r31)
	lfs f0, S_ORIGIN + 8(r29)
	fsubs f1, f1, f0
	fmadds f2, f1, f1, f2
	lfs f0, C_NEAR(r30)
	fcmpo cr0, f2, f0
	blt 3f
2:	addi r29, r29, SLOT
	bdnz 1b
	b 9f
# no target to aim at (the effect system hands the actor's target to its effects, +0x1DC), rows (dir.y, -dir.x, 0)
# across, the direction, up
3:	li r0, 0
	stw r0, 0x1dc(r31)
	stw r0, 0xe0(r31)
	lfs f1, S_DIR(r29)
	lfs f2, S_DIR + 4(r29)
	lfs f0, C_ZERO(r30)
	lfs f3, C_ONE(r30)
	stfs f1, 0x130(r31)
	stfs f2, 0x134(r31)
	stfs f0, 0x138(r31)
	fneg f4, f1
	stfs f2, 0xe4(r31)
	stfs f4, 0xe8(r31)
	stfs f0, 0xec(r31)
	stfs f1, 0xf4(r31)
	stfs f2, 0xf8(r31)
	stfs f0, 0xfc(r31)
	stfs f0, 0x104(r31)
	stfs f0, 0x108(r31)
	stfs f3, 0x10c(r31)
	lfs f1, S_DIST(r29)
	fcmpo cr0, f31, f1
	ble 9f
	fmr f31, f1
9:	fmr f1, f31
	lfd f31, 0x18(r1)
	lmw r29, 0x24(r1)
	lwz r0, 0x34(r1)
	mtlr r0
	addi r1, r1, 0x30
	blr

# Entity r3's laser, once a frame. Locals: 0x8-0x17 fn_8002FD50's stack arguments (in hurt's frame), 0x20 the stick,
# 0x30 where a tick hits, 0x40 the ray's hit (0x48 bytes), 0x90 the new facing, 0xa0 scratch.
update:
	stwu r1, -0x100(r1)
	mflr r0
	stw r0, 0x104(r1)
	stmw r24, 0xc0(r1)
	stfd f31, 0xe0(r1)
	mr r31, r3
	bl refresh
	mr r4, r31
	bl slot_of
	mr. r29, r9
	beq 99f
	mr r30, r11
	bl here
	addi r28, r11, consts - data
	mr r4, r31
	li r5, FLAG
	call stealth_test
	mr r27, r0
	lwz r0, 0x304(r31)
	andi. r0, r0, 0x100
	beq 1f
	li r27, 0
1:	lwz r26, 0x3dc(r31)
	cmpwi r26, 0
	bne 2f
	li r27, 0
	b 3f
2:	lbz r0, 8(r26)
	cmplwi r0, STAND
	beq 3f
	li r27, 0
3:	cmpwi r27, 0
	bne 10f
	lwz r0, S_STATE(r30)
	andi. r9, r0, ON
	beq 99f
	rlwinm r0, r0, 0, 0, 30
	stw r0, S_STATE(r30)
	mr r3, r31
	addi r4, r29, E_EFFECT
	andi. r0, r0, ALT
	beq 4f
	addi r4, r29, E_ALTEFFECT
4:	li r5, 0
	call fn_80393A60
	cmpwi r3, 0
	beq 99f
	lwz r9, 0xc8(r3)
	lha r0, 0x1b8(r9)
	lwz r12, 0x1bc(r9)
	add r3, r3, r0
	mtctr r12
	bctrl
	b 99f

# The stick turns the character toward it, at most the entry's turn rate.
10:	mr r3, r26
	li r4, 0
	addi r5, r1, 0x20
	bl move_raw
	lfs f0, C_STICK(r28)
	fcmpo cr0, f1, f0
	ble 19f
	lfs f0, C_ZERO(r28)
	stfs f0, 0x28(r1)
	addi r3, r1, 0x20
	mr r4, r3
	bl vunit
	lfs f0, C_TINY(r28)
	fcmpo cr0, f1, f0
	ble 19f
	lfs f0, 0x88(r31)
	stfs f0, 0x90(r1)
	lfs f0, 0x8c(r31)
	stfs f0, 0x94(r1)
	lfs f0, C_ZERO(r28)
	stfs f0, 0x98(r1)
	addi r3, r1, 0x90
	mr r4, r3
	bl vunit
	lfs f0, C_TINY(r28)
	fcmpo cr0, f1, f0
	ble 19f
	lis r9, 0x8059
	lfs f7, 0x3c38(r9)
	lfs f0, E_TURN(r29)
	fmuls f7, f7, f0
	lfs f0, C_MAXSTEP(r28)
	fcmpo cr0, f7, f0
	ble 11f
	fmr f7, f0
11:	lfs f1, 0x90(r1)
	lfs f2, 0x94(r1)
	lfs f3, 0x20(r1)
	lfs f4, 0x24(r1)
	fmuls f5, f1, f3
	fmadds f5, f2, f4, f5
	fmuls f6, f1, f4
	fnmsubs f6, f2, f3, f6
	fmuls f8, f7, f7
	lfs f0, C_HALF(r28)
	lfs f9, C_ONE(r28)
	fnmsubs f8, f8, f0, f9
	fcmpo cr0, f5, f8
	blt 12f
	addi r4, r1, 0x20
	b 18f
12:	lfs f0, C_ZERO(r28)
	fcmpo cr0, f6, f0
	bge 13f
	fneg f7, f7
13:	fmuls f9, f1, f8
	fnmsubs f9, f2, f7, f9
	fmuls f10, f1, f7
	fmadds f10, f2, f8, f10
	stfs f9, 0x90(r1)
	stfs f10, 0x94(r1)
	addi r3, r1, 0x90
	mr r4, r3
	bl vunit
	addi r4, r1, 0x90
# and the ground state's own wanted direction (+0x440), which it otherwise turns the actor back to (fn_800C0F48)
18:	mr r25, r4
	mr r3, r31
	call fn_8005A9B8
	lfs f0, 0(r25)
	stfs f0, 0x440(r26)
	lfs f0, 4(r25)
	stfs f0, 0x444(r26)
	lfs f0, 8(r25)
	stfs f0, 0x448(r26)

# The beam's origin, direction and length: a ray from attachment 67/0 (or 1.2 above the feet) along the facing, level.
19:	mr r3, r31
	call fn_8009AD80
	mr r24, r3
	mr r3, r31
	call fn_800B1668
	mr r7, r3
	mr r3, r24
	li r4, KIND
	li r5, 0
	addi r6, r30, S_ORIGIN
	call fn_801A5104
	cmpwi r3, 0
	bne 20f
	lfs f0, 0xa8(r31)
	stfs f0, S_ORIGIN(r30)
	lfs f0, 0xac(r31)
	stfs f0, S_ORIGIN + 4(r30)
	lfs f0, 0xb0(r31)
	lfs f1, C_UP(r28)
	fadds f0, f0, f1
	stfs f0, S_ORIGIN + 8(r30)
20:	lfs f0, 0x88(r31)
	stfs f0, S_DIR(r30)
	lfs f0, 0x8c(r31)
	stfs f0, S_DIR + 4(r30)
	lfs f0, C_ZERO(r28)
	stfs f0, S_DIR + 8(r30)
	addi r3, r30, S_DIR
	mr r4, r3
	bl vunit
	addi r3, r1, 0x40
	call __9Placement
	mr r3, r31
	call fn_800B24AC
	mr r7, r3
	addi r3, r30, S_ORIGIN
	addi r4, r30, S_DIR
	lfs f1, E_RANGE(r29)
	li r5, 0x2000
	addi r6, r1, 0x40
	li r8, 0
	li r9, 0
	li r10, 0
	call fn_8004A758
	li r27, 0
	lfs f0, E_RANGE(r29)
	stfs f0, S_DIST(r30)
	cmpwi r3, 0
	beq 21f
	addi r3, r1, 0x40
	call fn_80434E0C
	lfs f0, C_ZERO(r28)
	fcmpo cr0, f1, f0
	bge 22f
	fmr f1, f0
22:	lfs f0, E_RANGE(r29)
	fcmpo cr0, f1, f0
	bge 23f
	stfs f1, S_DIST(r30)
23:	addi r3, r1, 0x40
	call fn_80048A74
	mr r27, r3

# The effect starts once the beam is known.
21:	lwz r0, S_STATE(r30)
	andi. r9, r0, ON
	bne 30f
	ori r0, r0, ON
	stw r0, S_STATE(r30)
	lfs f0, E_TICK(r29)
	stfs f0, S_ACC(r30)
	mr r3, r31
	addi r4, r29, E_EFFECT
	andi. r0, r0, ALT
	beq 24f
	addi r4, r29, E_ALTEFFECT
24:	li r5, 0xff
	li r6, 0xff
	call fn_80393D0C
	cmpwi r3, 0
	beq 30f
	lwz r9, 0xc8(r3)
	lha r0, 0x1c8(r9)
	lwz r12, 0x1cc(r9)
	add r3, r3, r0
	mtctr r12
	bctrl

# A tick every E_TICK seconds: what the ray hits, then every other player the beam passes through.
30:	lis r9, 0x8059
	lfs f0, 0x3c38(r9)
	lfs f1, S_ACC(r30)
	fadds f1, f1, f0
	lfs f2, E_TICK(r29)
	fcmpo cr0, f1, f2
	bge 31f
	stfs f1, S_ACC(r30)
	b 99f
31:	fsubs f1, f1, f2
	fcmpo cr0, f1, f2
	blt 32f
	lfs f1, C_ZERO(r28)
32:	stfs f1, S_ACC(r30)
	addi r3, r1, 0x30
	addi r4, r30, S_ORIGIN
	addi r5, r30, S_DIR
	lfs f1, S_DIST(r30)
	bl vmad
	cmpwi r27, 0
	beq 40f
	lbz r0, 0(r27)
	cmpwi r0, 0
	beq 34f
	cmpwi r0, 7
	beq 34f
	cmpwi r0, 2
	beq 33f
	cmpwi r0, 8
	bne 35f
33:	mr r3, r27
	mr r4, r31
	li r5, 1
	lwz r6, E_TYPE(r29)
	lfs f1, E_DAMAGE(r29)
	addi r7, r1, 0x30
	addi r8, r30, S_DIR
	lfs f2, C_ZERO(r28)
	li r9, 0
	call fn_800A2F94
35:	li r27, 0
	b 40f
34:	cmpw r27, r31
	beq 35b
	mr r3, r27
	addi r4, r1, 0x30
	bl hurt

40:	li r24, 0
41:	lis r3, 0x8055
	addi r3, r3, 0x2110
	call fn_80434900
	cmpw r24, r3
	bge 99f
	lis r3, 0x8055
	addi r3, r3, 0x2110
	mr r4, r24
	call fn_804317BC
	call fn_8042FF2C
	addi r24, r24, 1
	mr. r25, r3
	beq 41b
	cmpw r25, r31
	beq 41b
	cmpw r25, r27
	beq 41b
	lfs f1, 0xa8(r25)
	lfs f0, S_ORIGIN(r30)
	fsubs f1, f1, f0
	lfs f2, 0xac(r25)
	lfs f0, S_ORIGIN + 4(r30)
	fsubs f2, f2, f0
	lfs f3, S_DIR(r30)
	lfs f4, S_DIR + 4(r30)
	fmuls f5, f1, f3
	fmadds f5, f2, f4, f5
	lfs f0, C_ZERO(r28)
	fcmpo cr0, f5, f0
	bge 42f
	fmr f5, f0
42:	lfs f0, S_DIST(r30)
	fcmpo cr0, f5, f0
	ble 43f
	fmr f5, f0
43:	fnmsubs f1, f3, f5, f1
	fnmsubs f2, f4, f5, f2
	fmuls f6, f1, f1
	fmadds f6, f2, f2, f6
	lfs f7, 0x44(r25)
	lfs f0, E_RADIUS(r29)
	fadds f7, f7, f0
	fmuls f7, f7, f7
	fcmpo cr0, f6, f7
	bgt 41b
	lfs f8, S_ORIGIN + 8(r30)
	lfs f9, 0xb0(r25)
	lfs f0, E_RADIUS(r29)
	fsubs f10, f9, f0
	fcmpo cr0, f8, f10
	blt 41b
	lfs f11, 0x4c(r25)
	fadds f10, f9, f11
	fadds f10, f10, f0
	fcmpo cr0, f8, f10
	bgt 41b
	addi r3, r1, 0x30
	addi r4, r30, S_ORIGIN
	addi r5, r30, S_DIR
	fmr f1, f5
	bl vmad
	mr r3, r25
	addi r4, r1, 0x30
	bl hurt
	b 41b

99:	lfd f31, 0xe0(r1)
	lmw r24, 0xc0(r1)
	lwz r0, 0x104(r1)
	mtlr r0
	addi r1, r1, 0x100
	blr

# One tick on player r3 at r4, as a melee hit (kind 1: a block stops it), then its hit reaction as fn_800E6D54 plays a
# punch's (the victim's controller s37, then fn_80041588), from update's r31 (the laser's actor), r30 (its slot), r29 (its entry) and r28 (consts):
# none when it is knocked out, or blocking and facing the beam (as fn_800A0488 has a blocked projectile).
hurt:
	stwu r1, -0x40(r1)
	mflr r0
	stw r0, 0x44(r1)
	stw r26, 0x38(r1)
	stw r27, 0x3c(r1)
	mr r26, r3
	mr r27, r4
	lwz r0, 0x304(r26)
	andi. r0, r0, 0x100
	bne 9f
	lwz r9, 0x3dc(r26)
	cmpwi r9, 0
	beq 1f
	lwz r0, 0x18(r9)
	andi. r0, r0, 0x100
	beq 1f
	lfs f1, 0x88(r26)
	lfs f2, S_DIR(r30)
	fmuls f3, f1, f2
	lfs f1, 0x8c(r26)
	lfs f2, S_DIR + 4(r30)
	fmadds f3, f1, f2, f3
	fneg f3, f3
	lfs f0, C_BLOCK(r28)
	fcmpo cr0, f3, f0
	bge 9f
1:	li r0, 0
	stw r0, 0x8(r1)
	stw r0, 0xc(r1)
	li r0, 0xff
	stw r0, 0x10(r1)
	stw r0, 0x14(r1)
	mr r3, r26
	mr r4, r31
	li r5, 1
	lwz r6, E_TYPE(r29)
	lfs f1, E_DAMAGE(r29)
	mr r7, r27
	addi r8, r30, S_DIR
	lwz r9, E_FLAGS(r29)
	li r10, 1
	lfs f2, C_ZERO(r28)
	call fn_8002FD50
	lfs f0, C_ZERO(r28)
	fcmpo cr0, f1, f0
	ble 9f
	lwz r0, 0x304(r26)
	andi. r0, r0, 0x100
	bne 9f
	lwz r0, 0x3dc(r26)
	cmpwi r0, 0
	beq 9f
	mr r3, r31
	call fn_800B13D8
	mr r27, r3
	lwz r3, 0x3dc(r26)
	lwz r9, 0x3ac(r3)
	lha r0, 0x130(r9)
	lwz r12, 0x134(r9)
	add r3, r3, r0
	lwz r4, E_REACT(r29)
	addi r5, r31, 0xa8
	li r6, 1
	lfs f1, C_ONE(r28)
	li r7, 0
	mr r8, r27
	li r9, 0
	li r10, 0
	mtctr r12
	bctrl
	mr r3, r26
	mr r4, r31
	li r5, 1
	call fn_80041588
9:	lwz r27, 0x3c(r1)
	lwz r26, 0x38(r1)
	lwz r0, 0x44(r1)
	mtlr r0
	addi r1, r1, 0x40
	blr

# r9 = actor r4's laser entry, or 0, and r11 its slot. Uses r0, r10, ctr.
slot_of:
	mflr r10
	bl here
	mtlr r10
	li r9, 0
	cmpwi r4, 0
	beqlr
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

# Each player's actor, laser entry and costume, once a frame. A slot whose actor changes forgets its beam.
refresh:
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r24, 0x10(r1)
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
	li r24, 0
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
	lwz r27, COUNT(r31)
	addi r26, r31, ENTRIES
3:	cmpwi r27, 0
	ble 4f
	addi r3, r29, 4
	addi r4, r26, E_NAME
	call strcmp
	cmpwi r3, 0
	beq 5f
	addi r3, r29, 4
	addi r4, r26, E_ALTNAME
	call strcmp
	li r24, ALT
	cmpwi r3, 0
	beq 5f
	li r24, 0
	addi r26, r26, ENTRY
	addi r27, r27, -1
	b 3b
4:	li r26, 0
	li r24, 0
5:	lwz r0, 4 + S_ACTOR(r28)
	cmpw r0, r25
	beq 6f
	li r0, 0
	stw r0, 4 + S_STATE(r28)
	stw r0, 4 + S_ACC(r28)
6:	stw r25, 4 + S_ACTOR(r28)
	stw r26, 4 + S_ENTRY(r28)
	lwz r0, 4 + S_STATE(r28)
	rlwinm r0, r0, 0, 31, 29
	or r0, r0, r24
	stw r0, 4 + S_STATE(r28)
	addi r30, r30, 1
	b 2b
9:	lmw r24, 0x10(r1)
	lwz r0, 0x34(r1)
	mtlr r0
	addi r1, r1, 0x30
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

# r3 = r4 / |r4|, f1 = |r4| (r28 = consts); with f1 = 0, r3 is left alone.
vunit:
	lfs f1, 0(r4)
	fmuls f1, f1, f1
	lfs f0, 4(r4)
	fmadds f1, f0, f0, f1
	lfs f0, 8(r4)
	fmadds f1, f0, f0, f1
	lfs f0, C_TINY(r28)
	fcmpo cr0, f1, f0
	bgt 1f
	lfs f1, C_ZERO(r28)
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
	.float 0, 0.5, 1.5, 1
	.float 1e-12, 0.2, 0.3, 1.2
	.float 0.5, 0.125, 0.004, 1
	.4byte 0x43300000, 0

	.balign 4
data:
