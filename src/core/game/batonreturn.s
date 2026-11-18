# The baton's return off a fighter (`base_moves.throw_return`), after airthrow.s in the Daredevil text section (game/dol.ts, daredevil).
# Position-independent like airthrow.s: game functions are called through ctr and `data` is found from the pc.
#   powerpc-eabi-as -mgekko -mregnames -o batonreturn.o batonreturn.s
#   powerpc-eabi-ld -Ttext=0x80700000 -e br_hit \
#     --defsym Entity_GetActor=0x800CC5E0 --defsym fn_80434900=0x80434900 --defsym fn_804317BC=0x804317BC \
#     --defsym fn_8042FF2C=0x8042FF2C --defsym strcmp=0x80172654 -o batonreturn.elf batonreturn.o
#   powerpc-eabi-objcopy -O binary -j .text batonreturn.elf batonreturn.bin
# `data`: {u32 count, count x {char[32] entity name, char[32] alt entity name}}, written by dol.ts.
	.text
	.globl br_hit
	.set ENTRY, 0x40

	.macro call fn
	lis r12, \fn@ha
	addi r12, r12, \fn@l
	mtctr r12
	bctrl
	.endm

# fn_800E7A4C's fighter-hit branch, in place of its b to the epilogue (r30 self): a listed player goes on to the prop hit's return.
br_hit:
	stwu r1, -0x10(r1)
	mflr r0
	stw r0, 0x14(r1)
	mr r3, r30
	call Entity_GetActor
	cmpwi r3, 0
	beq 1f
	bl listed
1:	lwz r0, 0x14(r1)
	mtlr r0
	addi r1, r1, 0x10
	cmpwi r3, 0
	lis r12, 0x800e
	beq 2f
	ori r12, r12, 0x81c8
	b 3f
2:	ori r12, r12, 0x82a8
3:	mtctr r12
	bctr

# r3 = actor r3's entry in `data` if it is a listed player, else 0.
listed:
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r25, 0x14(r1)
	mr r31, r3
	bl here
	mr r30, r11
	li r29, 0
	li r25, 0
1:	lis r3, 0x8055
	addi r3, r3, 0x2110
	call fn_80434900
	cmpw r29, r3
	bge 9f
	lis r3, 0x8055
	addi r3, r3, 0x2110
	mr r4, r29
	call fn_804317BC
	mr r28, r3
	call fn_8042FF2C
	addi r29, r29, 1
	cmpw r3, r31
	bne 1b
	lwz r27, 0(r30)
	addi r26, r30, 4
2:	cmpwi r27, 0
	ble 9f
	addi r3, r28, 4
	mr r4, r26
	call strcmp
	cmpwi r3, 0
	beq 3f
	addi r3, r28, 4
	addi r4, r26, 0x20
	call strcmp
	cmpwi r3, 0
	beq 3f
	addi r26, r26, ENTRY
	addi r27, r27, -1
	b 2b
3:	mr r25, r26
9:	mr r3, r25
	lmw r25, 0x14(r1)
	lwz r0, 0x34(r1)
	mtlr r0
	addi r1, r1, 0x30
	blr

# r11 = data, which follows this.
here:
	mflr r0
	bcl 20, 31, 1f
1:	mflr r11
	mtlr r0
	addi r11, r11, 0x10
	blr
