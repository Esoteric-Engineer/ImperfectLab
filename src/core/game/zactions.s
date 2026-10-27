# fn_80137494 as game/dol.ts (zActions) writes it.
#   powerpc-eabi-as -mgekko -mregnames -o zactions.o zactions.s
#   powerpc-eabi-ld -Ttext=0x80137494 -e stealth_update --defsym strcmp=0x80172654 --defsym fn_80434900=0x80434900 \
#     --defsym fn_804317BC=0x804317BC --defsym fn_8042FF2C=0x8042FF2C --defsym fn_80085EEC=0x80085EEC \
#     --defsym fn_80086730=0x80086730 --defsym fn_80084A60=0x80084A60 --defsym fn_801A5B1C=0x801A5B1C \
#     --defsym fn_800B0C58=0x800B0C58 --defsym fn_8015F278=0x8015F278 -o zactions.elf zactions.o
#   powerpc-eabi-objcopy -O binary -j .text zactions.elf zactions.bin
# `slots`: two {actor, stamp ms, seconds, flags}. `table`: {f32 seconds (0 drains nothing), u32 flags (1 keeps regen, 2 undetected, 4 untouchable), f32 fade, entity name, alt entity name},
# 4-aligned, ended by 12 zero bytes and "".
	.text
	.globl stealth_update, invulnerable, air_grab_check, ai_resolve_exit, ai_enemy_skip, slots, table

# From fn_800FB944 with r29 = the human input object.
stealth_update:
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
1:	lis r29, slots@ha
	addi r29, r29, slots@l
	lwz r0, 0(r29)
	cmpw r0, r30
	beq active
	addi r29, r29, 16
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
	lbz r0, 12(r26)
	cmpwi r0, 0
	beq done
	addi r21, r26, 12
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
	addi r29, r29, 16
	bdnz 2b
	b done
3:	stw r30, 0(r29)
	lwz r0, 0(r26)
	stw r0, 8(r29)
	lwz r0, 4(r26)
	stw r0, 12(r29)
	lfs f1, 8(r26)
	bl fade
	b stamp

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
	li r0, 0
	stw r0, 0(r29)
	lis r9, one@ha
	lfs f1, one@l(r9)
	bl fade
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

# r4 = entity, r5 = flags. r0 = 1 when it's in a live slot with one of them. Uses r9, r10, ctr.
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
2:	addi r9, r9, 16
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

	.balign 4
zero:	.float 0.0
one:	.float 1.0
slots:	.long 0, 0, 0, 0, 0, 0, 0, 0
table:
