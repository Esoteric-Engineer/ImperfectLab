# fn_80137494, fn_80138868 and fn_80148B50 (only reached from the AI debug display), and fn_800B1884 and fn_80086C80 in place,
# as game/dol.ts (zActions) writes them.
#   powerpc-eabi-as -mgekko -mregnames -o zactions.o zactions.s
#   powerpc-eabi-ld -Ttext=0x80137494 --section-start=.tuning=0x800B1884 --section-start=.taken=0x80086C80 \
#     --section-start=.grow=0x80148B50 --section-start=.costume=0x80138868 -e z_update \
#     --defsym strcmp=0x80172654 --defsym fn_80434900=0x80434900 --defsym fn_804317BC=0x804317BC --defsym fn_8042FF2C=0x8042FF2C \
#     --defsym fn_80085EEC=0x80085EEC --defsym fn_80086730=0x80086730 --defsym fn_80084A60=0x80084A60 --defsym fn_801A5B1C=0x801A5B1C \
#     --defsym fn_800B0C58=0x800B0C58 --defsym fn_8015F278=0x8015F278 --defsym fn_80433D20=0x80433D20 -o zactions.elf zactions.o
#   powerpc-eabi-objcopy -O binary -j <.text, .tuning, .taken, .grow or .costume> zactions.elf <section>.bin
# `slots`: two {actor, stamp ms, seconds, flags, entry, saved actor+0x308}.
# `sizes`: two {actor, f32 size now, f32 target, f32 change per second, saved radius, saved height}.
# `table`: {f32 seconds (0 drains nothing), u32 flags (1 keeps regen, 2 undetected, 4 untouchable, 8 costume, 16 stats, 32 size), f32 fade,
# [with 16: f32 damage[5], f32 taken, u32 lift bits; -1 keeps the game's], [with 32: f32 size], entity name, alt entity name}, 4-aligned,
# ended by 16 zero bytes and "".
	.text
	.globl z_update, invulnerable, air_grab_check, ai_resolve_exit, ai_enemy_skip, z_pose, z_tuning, z_taken, table
	.set SLOT, 24
	.set SIZES, 24
	.set STATS, 12
	.set NAMES, 12
	.set STATS_SIZE, 28

# From fn_800FB944 with r29 = the human input object.
z_update:
	stwu r1, -0x40(r1)
	mflr r0
	stw r0, 0x44(r1)
	stmw r21, 0x14(r1)
	mr r31, r29
	lwz r3, 0x5b4(r31)
	cmpwi r3, 0
	beq done
	lwz r30, 0xe4(r3)
	cmpwi r30, 0
	beq done
	lwz r9, 0x8(r31)
	lwz r28, 19 * 4(r9)
	li r27, 0
	lwz r9, 0xc(r31)
	cmpwi r9, 0
	beq 1f
	lwz r27, 19 * 4(r9)
1:	bl ease
	lis r29, slots@ha
	addi r29, r29, slots@l
	lwz r0, 0(r29)
	cmpw r0, r30
	beq active
	addi r29, r29, SLOT
	lwz r0, 0(r29)
	cmpw r0, r30
	beq active

	cmpwi r28, 0
	beq done
	cmpwi r27, 0
	bne done
	mr r3, r30
	bl fn_80085EEC
	cmpwi r3, 0
	bne done
	li r24, 0
player:
	lis r3, 0x8055
	addi r3, r3, 0x2110         # G
	bl fn_80434900
	cmpw r24, r3
	bge done
	lis r3, 0x8055
	addi r3, r3, 0x2110
	mr r4, r24
	bl fn_804317BC
	mr r23, r3
	bl fn_8042FF2C
	addi r24, r24, 1
	cmpw r3, r30
	bne player
	lis r26, table@ha
	addi r26, r26, table@l
entry:
	addi r21, r26, NAMES
	lwz r0, 4(r26)
	andi. r9, r0, 16
	beq 1f
	addi r21, r21, STATS_SIZE
1:	andi. r9, r0, 32
	beq 1f
	addi r21, r21, 4
1:	lbz r0, 0(r21)
	cmpwi r0, 0
	beq done
	addi r3, r23, 4
	mr r4, r21
	bl strcmp
	cmpwi r3, 0
	beq found
	mr r4, r21
	bl skip
	mr r21, r4
	addi r3, r23, 4
	bl strcmp
	cmpwi r3, 0
	beq found
	mr r4, r21
	bl skip
	addi r4, r4, 3
	clrrwi r26, r4, 2
	b entry
found:
	lfs f1, 0(r26)
	lis r9, zero@ha
	lfs f0, zero@l(r9)
	fcmpu cr0, f1, f0
	beq claim
	mr r3, r30
	bl fn_80086730
	lis r9, zero@ha
	lfs f0, zero@l(r9)
	fcmpu cr0, f1, f0
	ble done
claim:
	lis r29, slots@ha
	addi r29, r29, slots@l
	li r0, 2
	mtctr r0
	lis r9, 0x8059
	lwz r9, 0x3c2c(r9)          # game clock, ms
2:	lwz r0, 0(r29)
	cmpwi r0, 0
	beq 3f
	lwz r0, 4(r29)
	subf r0, r0, r9
	cmplwi r0, 250
	bge 3f
	addi r29, r29, SLOT
	bdnz 2b
	b done
3:	stw r30, 0(r29)
	lwz r0, 0(r26)
	stw r0, 8(r29)
	lwz r0, 4(r26)
	stw r0, 12(r29)
	stw r26, 16(r29)
	lwz r0, 0x308(r30)
	stw r0, 20(r29)
	li r25, 1
	b apply

active:
	cmpwi r28, 0
	beq off
	mr r3, r30
	bl fn_80085EEC
	cmpwi r3, 0
	bne off
	lfs f1, 8(r29)
	lis r9, zero@ha
	lfs f0, zero@l(r9)
	fcmpu cr0, f1, f0
	beq stamp
	lis r9, 0x8059
	lfs f2, 0x3c38(r9)          # dt
	lfs f3, 0x328(r30)
	fmuls f3, f3, f2
	fdivs f1, f3, f1
	lwz r0, 12(r29)
	andi. r0, r0, 1
	bne 4f
	lfs f4, 0x3cc(r30)
	fmadds f1, f4, f2, f1
4:	mr r3, r30
	bl fn_80084A60
	cmpwi r3, 0
	beq off
stamp:
	lis r9, 0x8059
	lwz r0, 0x3c2c(r9)
	stw r0, 4(r29)
	b done
off:
	li r25, 0
	stw r25, 0(r29)
	lwz r26, 16(r29)

# Puts the effects of slot r29 (entry r26) on r30 when r25 is 1, takes them off when 0.
apply:
	lfs f1, 8(r26)
	lis r9, one@ha
	lfs f0, one@l(r9)
	fcmpu cr0, f1, f0
	beq 1f
	cmpwi r25, 0
	bne 0f
	fmr f1, f0
0:	bl fade
1:	lwz r0, 12(r29)
	andi. r0, r0, 8
	beq 2f
	mr r3, r25
	bl costume
2:	lwz r0, 12(r29)
	andi. r0, r0, 16
	beq 3f
	lwz r9, STATS + 24(r26)
	cmpwi r9, -1
	beq 3f
	lwz r0, 0x308(r30)
	rlwinm r0, r0, 0, 28, 25
	cmpwi r25, 0
	bne 4f
	lwz r9, 20(r29)
	andi. r9, r9, 0x30
4:	or r0, r0, r9
	stw r0, 0x308(r30)
3:	lwz r0, 12(r29)
	andi. r0, r0, 32
	beq 5f
	bl grow
5:	cmpwi r25, 0
	bne stamp
done:
	lmw r21, 0x14(r1)
	lwz r0, 0x44(r1)
	mtlr r0
	addi r1, r1, 0x40
	blr

# r30's model to f1, at once.
fade:
	lwz r3, 0x1bc(r30)
	cmpwi r3, 0
	beqlr
	lis r9, zero@ha
	lfs f2, zero@l(r9)
	b fn_801A5B1C

# r4 past the string it points at; keeps r3.
skip:
	lbz r0, 0(r4)
	addi r4, r4, 1
	cmpwi r0, 0
	bne skip
	blr

# r4 = entity, r5 = flags. r0 = 1 and r9 = its slot when it's in a live slot with one of them. Uses r9, r10, ctr.
stealth_test:
	li r0, 0
	cmpwi r4, 0
	beqlr
	lis r9, slots@ha
	addi r9, r9, slots@l
	li r10, 2
	mtctr r10
1:	lwz r10, 0(r9)
	cmpw r10, r4
	bne 2f
	lis r10, 0x8059
	lwz r10, 0x3c2c(r10)
	lwz r0, 4(r9)
	subf r10, r0, r10
	li r0, 0
	cmplwi r10, 250
	bge 2f
	lwz r10, 12(r9)
	and. r10, r10, r5
	bne 3f
2:	addi r9, r9, SLOT
	bdnz 1b
	blr
3:	li r0, 1
	blr

# From fn_80085F4C when actor+0x304 bit 0 is clear.
invulnerable:
	mflr r12
	mr r4, r3
	li r5, 4
	bl stealth_test
	mtlr r12
	mr r3, r0
	blr

# fn_800E07A4's target check: fn_800B0C58, and not stealthed.
air_grab_check:
	stwu r1, -0x10(r1)
	mflr r0
	stw r0, 0x14(r1)
	stw r3, 0x8(r1)
	bl fn_800B0C58
	cmpwi r3, 0
	beq 1f
	lwz r4, 0x8(r1)
	li r5, 4
	bl stealth_test
	xori r3, r0, 1
1:	lwz r0, 0x14(r1)
	mtlr r0
	addi r1, r1, 0x10
	blr

# The shared exit of fn_80150200 and fn_80461948 (r3 = the target), in place of its first instruction.
ai_resolve_exit:
	mflr r12
	mr r4, r3
	li r5, 2
	bl stealth_test
	mtlr r12
	cmpwi r0, 0
	beq 1f
	li r3, 0
1:	lwz r11, 0(r1)
	blr

# fn_8014F8BC's enemy test: skip a stealthed candidate (r4).
ai_enemy_skip:
	mflr r12
	li r5, 2
	bl stealth_test
	mtlr r12
	cmpwi r0, 0
	bne 1f
	b fn_8015F278
1:	li r3, 1
	blr

# fn_800B1884's attack damage 22-26 (r4) of r3, from the table while Z changes stats.
z_damage:
	mflr r12
	mr r11, r4
	mr r4, r3
	li r5, 16
	bl stealth_test
	mtlr r12
	mr r4, r11
	cmpwi r0, 0
	beq 1f
	lwz r9, 16(r9)
	slwi r10, r4, 2
	addi r9, r9, STATS - 22 * 4
	lfsx f1, r9, r10
	lis r9, zero@ha
	lfs f0, zero@l(r9)
	fcmpu cr0, f1, f0
	bgelr
1:	b tuning

# f1, the damage r3 takes, scaled like hit type 0's to the table's while Z changes stats.
z_scale:
	mflr r12
	mr r4, r3
	li r5, 16
	bl stealth_test
	mtlr r12
	cmpwi r0, 0
	beqlr
	lwz r9, 16(r9)
	lfs f2, STATS + 20(r9)
	lis r10, zero@ha
	lfs f0, zero@l(r10)
	fcmpu cr0, f2, f0
	bltlr
	stwu r1, -0x20(r1)
	stw r12, 0x24(r1)
	stfs f1, 0x8(r1)
	stfs f2, 0xc(r1)
	li r4, 0x86
	bl z_tuning
	lis r9, one@ha
	lfs f0, one@l(r9)
	fsubs f0, f0, f1
	lfs f1, 0xc(r1)
	lis r9, zero@ha
	lfs f2, zero@l(r9)
	fcmpu cr0, f0, f2
	ble 1f
	lfs f2, 0x8(r1)
	fmuls f1, f1, f2
	fdivs f1, f1, f0
1:	lwz r0, 0x24(r1)
	mtlr r0
	addi r1, r1, 0x20
	blr

	.balign 4
sizes:	.long 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
table:

# fn_800B1884 (tuning field r4 of entity r3), in place.
	.section .tuning, "awx"
z_tuning:
	addi r0, r4, -22
	cmplwi r0, 4
	bgt tuning
	b z_damage
tuning:
	lwz r0, 0x16c(r3)
	cmpwi r0, 0
	beq 1f
	lwz r5, 0x170(r3)
	mr r3, r0
	b fn_80433D20
1:	lis r9, zero@ha
	lfs f1, zero@l(r9)
	blr
slots:	.long 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0

# fn_80086C80 (the damage r3 takes from hit type r4), in place.
	.section .taken, "awx"
z_taken:
	stwu r1, -0x10(r1)
	mflr r0
	stw r0, 0x14(r1)
	stw r31, 0xc(r1)
	mr r31, r3
	addi r4, r4, 0x86
	bl z_tuning
	lis r9, one@ha
	lfs f0, one@l(r9)
	fsubs f1, f0, f1
	mr r3, r31
	bl z_scale
	lwz r31, 0xc(r1)
	lwz r0, 0x14(r1)
	mtlr r0
	addi r1, r1, 0x10
	blr
zero:	.float 0.0
one:	.float 1.0
four:	.float 4.0

	.section .grow, "awx"
# r9 = r4's size record, else when r5 is 1 a free one taken for it, else 0. A record is free once its actor lacks the radius
# it gave it, as after a match. Uses r0, r10, r11, ctr, f0, f1.
size_of:
	lis r9, sizes@ha
	addi r9, r9, sizes@l
	li r10, 0
	li r0, 2
	mtctr r0
1:	lwz r11, 0(r9)
	cmpwi r11, 0
	beq 2f
	lfs f0, 4(r9)
	lfs f1, 16(r9)
	fmuls f0, f0, f1
	lfs f1, 0x44(r11)
	fcmpu cr0, f0, f1
	bne 2f
	cmpw r11, r4
	beqlr
	b 3f
2:	mr r10, r9
3:	addi r9, r9, SIZES
	bdnz 1b
	li r9, 0
	cmpwi r5, 0
	beqlr
	mr. r9, r10
	beqlr
	stw r4, 0(r9)
	lis r11, one@ha
	lfs f0, one@l(r11)
	stfs f0, 4(r9)
	lfs f0, 0x44(r4)
	stfs f0, 16(r9)
	lfs f0, 0x4c(r4)
	stfs f0, 20(r9)
	blr

# r30's size a step nearer its target, and its radius and height with it.
ease:
	mflr r12
	mr r4, r30
	li r5, 0
	bl size_of
	mtlr r12
	cmpwi r9, 0
	beqlr
	lfs f1, 4(r9)
	lfs f2, 8(r9)
	lfs f3, 12(r9)
	lis r10, 0x8059
	lfs f4, 0x3c38(r10)
	fmuls f3, f3, f4
	fsubs f0, f2, f1
	fabs f4, f0
	fcmpu cr0, f4, f3
	ble 1f
	fneg f4, f3
	fsel f3, f0, f3, f4
	fadds f2, f1, f3
1:	stfs f2, 4(r9)
	lfs f0, 16(r9)
	fmuls f0, f0, f2
	stfs f0, 0x44(r30)
	lfs f0, 20(r9)
	fmuls f0, f0, f2
	stfs f0, 0x4c(r30)
	lfs f0, 8(r9)
	lis r10, one@ha
	lfs f1, one@l(r10)
	fcmpu cr0, f2, f1
	bnelr
	fcmpu cr0, f0, f1
	bnelr
	li r0, 0
	stw r0, 0(r9)
	blr

# r30's size heads for entry r26's when r25 is 1, back to 1 when 0, over a quarter second.
grow:
	mflr r12
	mr r4, r30
	mr r5, r25
	bl size_of
	mtlr r12
	cmpwi r9, 0
	beqlr
	lis r10, one@ha
	lfs f2, one@l(r10)
	fmr f1, f2
	cmpwi r25, 0
	beq 2f
	lwz r0, 4(r26)
	andi. r0, r0, 16
	addi r10, r26, NAMES
	beq 1f
	addi r10, r10, STATS_SIZE
1:	lfs f1, 0(r10)
	fsubs f0, f1, f2
	fabs f0, f0
	lis r10, four@ha
	lfs f3, four@l(r10)
	fmuls f0, f0, f3
	stfs f0, 12(r9)
2:	stfs f1, 8(r9)
	blr

# fn_801A479C, in place of its lwz r0, 0xb0(r30): its world matrix (r31 + 0x10) to the actor's Z size before the bones are posed.
z_pose:
	mflr r12
	lwz r4, 0x8(r31)
	addi r4, r4, -0x78
	li r5, 0
	bl size_of
	mtlr r12
	cmpwi r9, 0
	beq 2f
	lfs f1, 4(r9)
	addi r9, r31, 0xc
	li r0, 12
	mtctr r0
1:	lfsu f0, 4(r9)
	fmuls f0, f0, f1
	stfs f0, 0(r9)
	bdnz 1b
2:	lwz r0, 0xb0(r30)
	blr

	.section .costume, "awx"
# The model's 3n parts are the costume's materials, their Z twins and untouched copies. Each material r30's meshes draw
# (part j, or a copy of the same name) takes texture 0 of part j + n when r3 is 1, of part j + 2n when 0.
costume:
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r23, 0xc(r1)
	mr r31, r3
	lwz r4, 0x1bc(r30)
	cmpwi r4, 0
	beq 9f
	lwz r5, 0(r4)
	lwz r29, 0xac(r4)
	lbz r28, 4(r5)
	lbz r27, 8(r5)
	li r0, 3
	divwu r27, r27, r0
	lwz r26, 0x88(r5)
1:	cmpwi r28, 0
	beq 9f
	lwz r25, 0(r29)
	li r24, 0
2:	cmpw r24, r27
	bge 4f
	slwi r0, r24, 2
	lwzx r23, r26, r0
	cmpw r23, r25
	beq 3f
	addi r3, r25, 0x28
	addi r4, r23, 0x28
	bl strcmp
	cmpwi r3, 0
	beq 3f
	addi r24, r24, 1
	b 2b
3:	add r0, r24, r27
	cmpwi r31, 0
	bne 5f
	add r0, r0, r27
5:	slwi r0, r0, 2
	lwzx r9, r26, r0
	lwz r0, 0x14(r9)
	stw r0, 0x14(r25)
4:	addi r29, r29, 4
	addi r28, r28, -1
	b 1b
9:	lmw r23, 0xc(r1)
	lwz r0, 0x34(r1)
	mtlr r0
	addi r1, r1, 0x30
	blr
